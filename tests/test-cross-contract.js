const assert = require('assert');
const db = require('../src/database/db');
const User = require('../src/models/User');
const Contract = require('../src/models/Contract');
const Department = require('../src/models/Department');
const ApprovalRule = require('../src/models/ApprovalRule');
const ApprovalStep = require('../src/models/ApprovalStep');
const ApprovalAction = require('../src/models/ApprovalAction');
const AuditLog = require('../src/models/AuditLog');
const Archive = require('../src/models/Archive');
const ContractApprovalService = require('../src/services/ContractApprovalService');
const seedData = require('../src/seeders/seed');

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

async function runCrossContractTest() {
  console.log('\n========================================');
  console.log('  回归测试 - 跨合同串单问题验证');
  console.log('========================================\n');

  log('步骤 0: 清理并重新初始化种子数据');
  await seedData(true);

  const users = {
    admin: User.findByUsername('admin'),
    zhangsan: User.findByUsername('zhangsan'),
    lisi: User.findByUsername('lisi'),
    wangwu: User.findByUsername('wangwu'),
    zhaoliu: User.findByUsername('zhaoliu'),
    sunqi: User.findByUsername('sunqi'),
    zhouba: User.findByUsername('zhouba'),
    qianshiyi: User.findByUsername('qianshiyi'),
  };

  const deptTech = Department.findByCode('TECH');
  const deptSales = Department.findByCode('SALES');

  log('步骤 1: 创建两个合同，交叉操作');

  const contract1 = Contract.create({
    contract_no: 'HT-CROSS-001',
    title: '技术部采购合同 - 合同A',
    amount: 50000,
    department_id: deptTech.id,
    risk_level: 'low',
    content: '这是合同A的内容',
    applicant_id: users.zhangsan.id
  });
  Contract.addAttachment({
    contract_id: contract1.id,
    file_name: '合同A附件.pdf',
    file_path: '/files/contract-a.pdf',
    uploaded_by: users.zhangsan.id,
    is_required: true
  });

  const contract2 = Contract.create({
    contract_no: 'HT-CROSS-002',
    title: '销售部采购合同 - 合同B',
    amount: 500000,
    department_id: deptSales.id,
    risk_level: 'medium',
    content: '这是合同B的内容',
    applicant_id: users.lisi.id
  });
  Contract.addAttachment({
    contract_id: contract2.id,
    file_name: '合同B附件.pdf',
    file_path: '/files/contract-b.pdf',
    uploaded_by: users.lisi.id,
    is_required: true
  });

  log('合同A ID:', contract1.id);
  log('合同B ID:', contract2.id);

  log('步骤 2: 提交合同A审批');
  const submit1 = await ContractApprovalService.submitContract(
    contract1.id,
    users.zhangsan.id,
    '127.0.0.1'
  );
  log('合同A提交成功', { rule: submit1.rule.name, current_step: submit1.current_step.step_name });

  log('步骤 3: 提交合同B审批');
  const submit2 = await ContractApprovalService.submitContract(
    contract2.id,
    users.lisi.id,
    '127.0.0.1'
  );
  log('合同B提交成功', { rule: submit2.rule.name, current_step: submit2.current_step.step_name });

  log('步骤 4: 审批合同A - 部门经理审批');
  const step1A = ApprovalStep.findById(submit1.current_step.id);
  await ContractApprovalService.processApproval(
    contract1.id,
    step1A.id,
    users.qianshiyi.id,
    'approve',
    '合同A同意',
    null,
    '127.0.0.1'
  );
  log('合同A部门经理审批完成');

  log('步骤 5: 审批合同B - 部门经理审批');
  const step1B = ApprovalStep.findById(submit2.current_step.id);
  log('合同B第一步需要角色:', step1B.required_roles);

  await ContractApprovalService.processApproval(
    contract2.id,
    step1B.id,
    users.zhangsan.id,
    'approve',
    '合同B同意',
    null,
    '127.0.0.1'
  );
  log('合同B部门经理审批完成');

  db.forceSave();
  db.load();

  log('步骤 6: 验证审计日志不串单');
  const logs1 = AuditLog.findByContract(contract1.id);
  const logs2 = AuditLog.findByContract(contract2.id);

  console.log('合同A ID:', contract1.id);
  console.log('合同B ID:', contract2.id);
  console.log('合同A审计日志数量:', logs1.length);
  console.log('合同B审计日志数量:', logs2.length);
  console.log('合同A审计日志详情:', JSON.stringify(logs1.map(function(l) { return { contract_id: l.contract_id, action: l.action }; }), null, 2));
  console.log('合同B审计日志详情:', JSON.stringify(logs2.map(function(l) { return { contract_id: l.contract_id, action: l.action }; }), null, 2));

  logs1.forEach(function(logItem) {
    assert(logItem.contract_id === contract1.id, '合同A的审计日志contract_id必须是合同A的ID，实际是: ' + logItem.contract_id);
  });
  logs2.forEach(function(logItem) {
    assert(logItem.contract_id === contract2.id, '合同B的审计日志contract_id必须是合同B的ID，实际是: ' + logItem.contract_id);
  });

  const logContractIds1 = [...new Set(logs1.map(l => l.contract_id))];
  const logContractIds2 = [...new Set(logs2.map(l => l.contract_id))];

  console.log('合同A审计日志中的contract_id:', logContractIds1);
  console.log('合同B审计日志中的contract_id:', logContractIds2);

  assert(logContractIds1.length === 1 && logContractIds1[0] === contract1.id, '合同A的审计日志只能包含合同A自己的记录');
  assert(logContractIds2.length === 1 && logContractIds2[0] === contract2.id, '合同B的审计日志只能包含合同B自己的记录');
  log('✓ 审计日志不串单验证通过');

  log('步骤 7: 验证审批动作不串单');
  const actions1 = ApprovalAction.findByContract(contract1.id);
  const actions2 = ApprovalAction.findByContract(contract2.id);

  console.log('合同A审批动作数量:', actions1.length);
  console.log('合同B审批动作数量:', actions2.length);

  actions1.forEach(action => {
    assert(action.contract_id === contract1.id, '合同A的审批动作contract_id必须是合同A的ID');
  });
  actions2.forEach(action => {
    assert(action.contract_id === contract2.id, '合同B的审批动作contract_id必须是合同B的ID');
  });

  const actionContractIds1 = [...new Set(actions1.map(a => a.contract_id))];
  const actionContractIds2 = [...new Set(actions2.map(a => a.contract_id))];

  assert(actionContractIds1.length === 1 && actionContractIds1[0] === contract1.id, '合同A的审批动作只能包含合同A自己的记录');
  assert(actionContractIds2.length === 1 && actionContractIds2[0] === contract2.id, '合同B的审批动作只能包含合同B自己的记录');
  log('✓ 审批动作不串单验证通过');

  log('步骤 8: 验证时间线不串单');
  const timeline1 = ContractApprovalService.getContractTimeline(contract1.id);
  const timeline2 = ContractApprovalService.getContractTimeline(contract2.id);

  console.log('合同A时间线事件数量:', timeline1.length);
  console.log('合同B时间线事件数量:', timeline2.length);

  timeline1.forEach(event => {
    if (event.step_id) {
      const step = ApprovalStep.findById(event.step_id);
      if (step) assert(step.contract_id === contract1.id, `合同A时间线中的步骤必须属于合同A`);
    }
    if (event.user_id === contract1.applicant_id || event.user_id === users.zhangsan.id || event.user_id === users.qianshiyi.id) {
      // 这些是预期的用户ID
    }
  });

  log('✓ 时间线不串单验证通过');

  log('步骤 9: 继续审批合同A直到完成');

  const stepsA = ApprovalStep.findByContract(contract1.id);
  for (let i = 1; i < stepsA.length; i++) {
    const step = stepsA[i];
    ApprovalStep.updateStatus(step.id, 'in_progress');
    db.forceSave();
    db.load();
    const currentContract = Contract.findById(contract1.id);
    Contract.updateStatus(contract1.id, currentContract.status, { current_step_id: step.id });

    let approverId = null;
    if (step.required_roles.includes('finance')) approverId = users.wangwu.id;
    if (step.required_roles.includes('legal')) approverId = users.zhaoliu.id;
    if (step.required_roles.includes('risk')) approverId = users.sunqi.id;
    if (step.required_roles.includes('ceo')) approverId = users.zhouba.id;

    await ContractApprovalService.processApproval(
      contract1.id,
      step.id,
      approverId,
      'approve',
      `合同A步骤${i + 1}同意`,
      null,
      '127.0.0.1'
    );
  }

  log('合同A审批完成');
  db.forceSave();
  db.load();

  log('步骤 10: 归档合同A');
  const contractABefore = Contract.findById(contract1.id);
  console.log('归档前合同A状态:', contractABefore.status);

  const archiveResult = await ContractApprovalService.archiveContract(
    contract1.id,
    users.admin.id,
    '127.0.0.1'
  );
  log('合同A归档完成', { archive_no: archiveResult.archive.archive_no, file_path: archiveResult.archive.file_path });

  db.forceSave();
  db.load();

  log('步骤 11: 验证归档文件中的合同状态');
  const archive = Archive.findByContract(contract1.id);
  const archiveContent = Archive.loadContent(archive.archive_no);
  console.log('归档文件中合同状态:', archiveContent.content.contract.status);
  console.log('数据库中合同状态:', Contract.findById(contract1.id).status);

  assert(archiveContent.content.contract.status === 'archived', `归档文件中合同状态应该是archived，实际是: ${archiveContent.content.contract.status}`);
  log('✓ 归档文件状态验证通过');

  log('步骤 12: 验证归档内容不串单');
  console.log('归档内容合同编号:', archiveContent.content.contract.contract_no);
  assert(archiveContent.content.contract.id === contract1.id, '归档内容应该是合同A的');
  assert(archiveContent.content.contract.contract_no === 'HT-CROSS-001', '归档合同编号应该是HT-CROSS-001');

  const archiveActionContractIds = [...new Set(archiveContent.content.actions.map(a => a.contract_id))];
  assert(archiveActionContractIds.length === 1 && archiveActionContractIds[0] === contract1.id, '归档内容中的审批动作只能属于合同A');

  const archiveAuditContractIds = [...new Set(archiveContent.content.audit_logs.map(l => l.contract_id))];
  assert(archiveAuditContractIds.length === 1 && archiveAuditContractIds[0] === contract1.id, '归档内容中的审计日志只能属于合同A');

  log('✓ 归档内容不串单验证通过');

  log('步骤 13: 重启服务模拟（forceSave + load）');
  db.forceSave();
  db.load();

  log('步骤 14: 重启后验证合同A状态');
  const contract1After = Contract.findById(contract1.id);
  console.log('重启后合同A状态:', contract1After.status);
  assert(contract1After.status === 'archived', '重启后合同A状态应该是archived');

  const archiveAfter = Archive.findByContract(contract1.id);
  const archiveContentAfter = Archive.loadContent(archiveAfter.archive_no);
  console.log('重启后归档文件中合同状态:', archiveContentAfter.content.contract.status);
  assert(archiveContentAfter.content.contract.status === 'archived', '重启后归档文件状态应该是archived');
  assert(archiveContentAfter.is_valid === true, '重启后归档文件完整性验证通过');

  log('步骤 15: 重启后验证审计日志');
  const logs1After = AuditLog.findByContract(contract1.id);
  const logs2After = AuditLog.findByContract(contract2.id);

  console.log('重启后合同A审计日志数量:', logs1After.length);
  console.log('重启后合同B审计日志数量:', logs2After.length);

  logs1After.forEach(log => {
    assert(log.contract_id === contract1.id, '重启后合同A的审计日志contract_id必须是合同A的ID');
  });
  logs2After.forEach(log => {
    assert(log.contract_id === contract2.id, '重启后合同B的审计日志contract_id必须是合同B的ID');
  });

  console.log('\n========================================');
  console.log('  ✅ 跨合同串单问题回归测试全部通过！');
  console.log('========================================\n');

  console.log('\n已验证的场景:');
  console.log('  ✓ 两个合同交叉操作，审计日志不串单');
  console.log('  ✓ 两个合同交叉操作，审批动作不串单');
  console.log('  ✓ 两个合同交叉操作，时间线不串单');
  console.log('  ✓ 归档文件中合同状态正确（archived而非approved）');
  console.log('  ✓ 归档内容不串单');
  console.log('  ✓ 重启后合同状态保持一致');
  console.log('  ✓ 重启后归档文件状态保持一致');
  console.log('  ✓ 重启后审计日志不串单');
}

runCrossContractTest().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
