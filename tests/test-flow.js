const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const Contract = require('../src/models/Contract');
const ApprovalRule = require('../src/models/ApprovalRule');
const ApprovalStep = require('../src/models/ApprovalStep');
const ApprovalAction = require('../src/models/ApprovalAction');
const AuditLog = require('../src/models/AuditLog');
const Archive = require('../src/models/Archive');
const ContractApprovalService = require('../src/services/ContractApprovalService');
const RuleEngine = require('../src/services/RuleEngine');

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  if (data) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ 断言失败: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

async function runMainFlowTest() {
  console.log('\n========================================');
  console.log('  验收测试 - 主流程验证');
  console.log('========================================\n');

  log('步骤 0: 清理并重新初始化种子数据');
  const { execSync } = require('child_process');
  execSync('node src/seeders/seed.js', { stdio: 'inherit' });

  db.load();

  const users = {
    zhangsan: User.findByUsername('zhangsan'),
    lisi: User.findByUsername('lisi'),
    wangwu: User.findByUsername('wangwu'),
    zhaoliu: User.findByUsername('zhaoliu'),
    sunqi: User.findByUsername('sunqi'),
    zhouba: User.findByUsername('zhouba'),
    wujiu: User.findByUsername('wujiu'),
    zhengshi: User.findByUsername('zhengshi'),
    qianshiyi: User.findByUsername('qianshiyi'),
    admin: User.findByUsername('admin')
  };
  
  const depts = {
    tech: Department.findByCode('TECH'),
    sales: Department.findByCode('SALES')
  };

  log('步骤 1: 创建高风险大额合同 (200万，中风险 → 命中"高风险大额合同"规则)');
  const contractData = {
    contract_no: 'HT-2025-MAIN-001',
    title: '核心系统升级项目合同',
    amount: 2000000,
    currency: 'CNY',
    department_id: depts.tech.id,
    risk_level: 'medium',
    content: '这是一个200万的核心系统升级合同，涉及重要系统改造',
    attachments: [
      {
        file_name: '合同正文.pdf',
        file_type: 'application/pdf',
        file_size: 150000,
        is_required: true
      }
    ]
  };
  
  let contract = Contract.create({
    ...contractData,
    applicant_id: users.zhangsan.id
  });
  Contract.addAttachment({
    contract_id: contract.id,
    ...contractData.attachments[0],
    uploaded_by: users.zhangsan.id
  });
  
  contract = Contract.findById(contract.id);
  assert(contract.status === 'draft', '合同状态为草稿');
  assert(contract.amount === 2000000, '合同金额正确');
  log('合同创建成功', { id: contract.id, contract_no: contract.contract_no });

  log('步骤 2: 查看规则命中预测');
  const matchResult = RuleEngine.findMatchingRule(contract);
  assert(matchResult !== null, '能匹配到规则');
  assert(matchResult.rule.name === '高风险大额合同', '命中"高风险大额合同"规则');
  log('命中规则', {
    rule: matchResult.rule.name,
    version: matchResult.rule.version,
    priority: matchResult.rule.priority,
    hit_reason: matchResult.reason
  });

  log('步骤 3: 提交合同审批');
  const submitResult = await ContractApprovalService.submitContract(
    contract.id,
    users.zhangsan.id,
    '127.0.0.1'
  );
  assert(submitResult.rule.name === '高风险大额合同', '提交时命中正确规则');
  assert(submitResult.contract.status === 'approving', '合同状态变为审批中');
  log('提交成功', {
    rule: submitResult.rule,
    hit_reason: submitResult.hit_reason,
    current_step: submitResult.current_step.step_name
  });

  contract = Contract.findById(contract.id);
  assert(contract.rule_hit_reason !== null, '规则命中原因已保存');
  assert(contract.rule_version === 1, '规则版本已记录');

  log('步骤 4: 查看当前审批步骤');
  const currentStep = ContractApprovalService.getCurrentStep(contract.id);
  assert(currentStep.step.name === '部门经理审批', '当前步骤为部门经理审批');
  assert(currentStep.step.type === 'single', '步骤类型为单人审批');
  log('当前步骤', currentStep);

  log('步骤 5: 查看待办列表 (以王五/财务身份)');
  const todosWangwu = ContractApprovalService.getTodoList(users.wangwu.id);
  assert(todosWangwu.length > 0, '财务有待办事项');
  log('财务待办', todosWangwu.map(t => ({
    contract_no: t.contract_no,
    step_name: t.step_name,
    applicant: t.applicant_name
  })));

  log('步骤 6: 审批 - 部门经理审批 (钱十一/技术部经理)');
  const currentContract = Contract.findById(contract.id);
  const step1 = ApprovalStep.findById(currentContract.current_step_id);
  const approve1 = await ContractApprovalService.processApproval(
    contract.id,
    step1.id,
    users.qianshiyi.id,
    'approve',
    '同意，本项目符合技术部发展规划',
    null,
    '127.0.0.1'
  );
  assert(approve1.success === true, '部门经理审批成功');
  assert(approve1.step_completed === true, '步骤已完成');
  log('部门经理审批完成', approve1.message);

  log('步骤 7: 查看当前步骤 - 应进入会签步骤');
  const currentStep2 = ContractApprovalService.getCurrentStep(contract.id);
  assert(currentStep2.step.name.includes('会签'), '进入会签步骤');
  assert(currentStep2.step.type === 'countersign', '步骤类型为会签');
  assert(currentStep2.step.required_signatures === 2, '需要2人会签');
  log('当前步骤', {
    name: currentStep2.step.name,
    type: currentStep2.step.type,
    required: currentStep2.step.required_signatures
  });

  log('步骤 8: 会签 - 财务和风险会签 (第1人: 王五/财务)');
  const step2 = ApprovalStep.findById(currentStep2.step.id);
  const approve2a = await ContractApprovalService.processApproval(
    contract.id,
    step2.id,
    users.wangwu.id,
    'approve',
    '预算充足，同意',
    null,
    '127.0.0.1'
  );
  assert(approve2a.step_completed === false, '会签未完成 (1/2)');
  log('会签进度', approve2a.message);

  log('步骤 8.1: 测试重复提交 - 王五不能重复审批');
  try {
    await ContractApprovalService.processApproval(
      contract.id,
      step2.id,
      users.wangwu.id,
      'approve',
      '重复提交',
      null,
      '127.0.0.1'
    );
    assert(false, '应该抛出重复提交错误');
  } catch (e) {
    assert(e.message.includes('已对此步骤进行过审批'), '正确阻止重复审批');
    log('✓ 正确阻止重复审批', e.message);
  }

  log('步骤 9: 会签 - 财务和风险会签 (第2人: 孙七/风控)');
  const approve2b = await ContractApprovalService.processApproval(
    contract.id,
    step2.id,
    users.sunqi.id,
    'approve',
    '风险可控，同意',
    null,
    '127.0.0.1'
  );
  assert(approve2b.step_completed === true, '会签完成 (2/2)');
  log('会签完成', approve2b.message);

  log('步骤 10: 要求补件 - 测试补件流程');
  const currentStep3 = ContractApprovalService.getCurrentStep(contract.id);
  log('当前步骤', currentStep3.step.name);
  
  const supplementReq = await ContractApprovalService.processApproval(
    contract.id,
    currentStep3.step.id,
    users.zhaoliu.id,
    'request_supplement',
    '请补充项目技术方案详细说明',
    null,
    '127.0.0.1'
  );
  assert(supplementReq.supplement_requested === true, '已要求补件');
  contract = Contract.findById(contract.id);
  assert(contract.status === 'supplement_requested', '合同状态变为需要补件');
  log('已要求补件', supplementReq.message);

  log('步骤 11: 提交补件');
  const supplementSubmit = await ContractApprovalService.submitSupplement(
    contract.id,
    users.zhangsan.id,
    [
      {
        file_name: '技术方案补充说明.pdf',
        file_type: 'application/pdf',
        file_size: 200000
      }
    ],
    '已补充技术方案说明，请审阅',
    '127.0.0.1'
  );
  assert(supplementSubmit.success === true, '补件提交成功');
  contract = Contract.findById(contract.id);
  assert(contract.status === 'approving', '合同状态恢复为审批中');
  log('补件提交成功', supplementSubmit.message);

  log('步骤 12: 法务会签 (需2人) - 赵六审批');
  const currentStep4 = ContractApprovalService.getCurrentStep(contract.id);
  assert(currentStep4.step.name.includes('法务双人会签'), '法务会签步骤');
  const step4 = ApprovalStep.findById(currentStep4.step.id);
  
  const approve4a = await ContractApprovalService.processApproval(
    contract.id,
    step4.id,
    users.zhaoliu.id,
    'approve',
    '法律条款合规，同意',
    null,
    '127.0.0.1'
  );
  log('法务会签 1/2', approve4a.message);

  log('步骤 13: 测试越权审批 - 财务不能审批法务步骤');
  try {
    await ContractApprovalService.processApproval(
      contract.id,
      step4.id,
      users.wangwu.id,
      'approve',
      '越权审批',
      null,
      '127.0.0.1'
    );
    assert(false, '应该抛出越权错误');
  } catch (e) {
    assert(e.message.includes('越权操作'), '正确阻止越权审批');
    log('✓ 正确阻止越权审批', e.message);
  }

  log('步骤 14: 法务会签 (需2人) - 郑十审批');
  const approve4b = await ContractApprovalService.processApproval(
    contract.id,
    step4.id,
    users.zhengshi.id,
    'approve',
    '同意，条款完善',
    null,
    '127.0.0.1'
  );
  assert(approve4b.step_completed === true, '法务会签完成');
  log('法务会签 2/2 完成', approve4b.message);

  log('步骤 15: CEO 最终审批');
  const currentStep5 = ContractApprovalService.getCurrentStep(contract.id);
  assert(currentStep5.step.name === 'CEO最终审批', 'CEO审批步骤');
  const step5 = ApprovalStep.findById(currentStep5.step.id);
  
  const approve5 = await ContractApprovalService.processApproval(
    contract.id,
    step5.id,
    users.zhouba.id,
    'approve',
    '同意，按计划执行',
    null,
    '127.0.0.1'
  );
  assert(approve5.all_completed === true, '所有审批步骤完成');
  contract = Contract.findById(contract.id);
  assert(contract.status === 'approved', '合同状态为已批准');
  log('所有审批完成', approve5.message);

  log('步骤 16: 查看审批时间线');
  const timeline = ContractApprovalService.getContractTimeline(contract.id);
  assert(timeline.length > 10, '时间线包含多个事件');
  log('审批时间线 (前5条)', timeline.slice(0, 5).map(t => ({
    time: new Date(t.time).toLocaleString('zh-CN'),
    type: t.type,
    title: t.title
  })));

  log('步骤 17: 查看所有审批意见');
  const comments = ApprovalAction.findByContract(contract.id).filter(a => a.comment);
  assert(comments.length >= 5, '有多条审批意见');
  log('审批意见', comments.map(c => ({
    approver: c.approver_name,
    action: c.action,
    comment: c.comment,
    time: new Date(c.created_at).toLocaleString('zh-CN')
  })));

  log('步骤 18: 查看审计日志');
  db.forceSave();
  db.load();
  const auditLogs = AuditLog.findByContract(contract.id);
  assert(auditLogs.length >= 9, '有多条审计日志');
  log('审计日志 (前5条)', auditLogs.slice(0, 5).map(l => ({
    time: new Date(l.created_at).toLocaleString('zh-CN'),
    action: l.action,
    user: l.user_name
  })));

  log('步骤 19: 归档合同');
  const archiveResult = await ContractApprovalService.archiveContract(
    contract.id,
    users.admin.id,
    '127.0.0.1'
  );
  assert(archiveResult.success === true, '归档成功');
  contract = Contract.findById(contract.id);
  assert(contract.status === 'archived', '合同状态为已归档');
  assert(contract.archive_path !== null, '归档路径已保存');
  log('归档成功', {
    archive_no: archiveResult.archive.archive_no,
    file_path: archiveResult.archive.file_path,
    file_hash: archiveResult.archive.file_hash
  });

  log('步骤 20: 验证归档完整性');
  const verifyResult = Archive.verify(archiveResult.archive.archive_no);
  assert(verifyResult.valid === true, '归档文件完整性验证通过');
  log('归档完整性验证', verifyResult);

  log('步骤 21: 加载归档内容');
  const archiveContent = Archive.loadContent(archiveResult.archive.archive_no);
  assert(archiveContent.is_valid === true, '归档内容有效');
  assert(archiveContent.content.contract.contract_no === 'HT-2025-MAIN-001', '归档包含合同信息');
  assert(archiveContent.content.actions.length > 0, '归档包含审批记录');
  assert(archiveContent.content.audit_logs.length > 0, '归档包含审计日志');
  log('归档内容验证', {
    contract_no: archiveContent.content.contract.contract_no,
    actions_count: archiveContent.content.actions.length,
    steps_count: archiveContent.content.steps.length,
    audit_logs_count: archiveContent.content.audit_logs.length
  });

  log('步骤 22: 查看规则命中原因 (归档后仍可查询)');
  const hitReason = JSON.parse(contract.rule_hit_reason);
  log('规则命中原因 (已持久化)', hitReason);

  console.log('\n========================================');
  console.log('  ✅ 主流程验收测试全部通过！');
  console.log('========================================\n');

  console.log('\n数据一致性验证 - 重启后保持:');
  console.log('  ✓ 合同状态: archived (已归档)');
  console.log('  ✓ 规则版本: v1 (已记录)');
  console.log('  ✓ 规则命中原因: 已持久化到数据库');
  console.log('  ✓ 审计日志: 所有操作均有记录');
  console.log('  ✓ 归档文件: SHA256 哈希校验通过');
  console.log('  ✓ 审批历史: 所有步骤和意见均已保存');
  console.log('  ✓ 时间线: 完整的审批轨迹可追溯');
  
  return { contractId: contract.id, archiveNo: archiveResult.archive.archive_no };
}

if (require.main === module) {
  runMainFlowTest().catch(err => {
    console.error('测试失败:', err);
    process.exit(1);
  });
}

module.exports = runMainFlowTest;
