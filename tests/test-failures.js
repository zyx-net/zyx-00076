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

async function runFailureTests() {
  console.log('\n========================================');
  console.log('  验收测试 - 失败路径验证');
  console.log('========================================\n');

  const { execSync } = require('child_process');
  execSync('node src/seeders/seed.js', { stdio: 'inherit' });

  db.forceSave();
  db.load();

  const users = {
    zhangsan: User.findByUsername('zhangsan'),
    lisi: User.findByUsername('lisi'),
    wangwu: User.findByUsername('wangwu'),
    zhaoliu: User.findByUsername('zhaoliu'),
    sunqi: User.findByUsername('sunqi'),
    zhouba: User.findByUsername('zhouba'),
    admin: User.findByUsername('admin')
  };
  
  const depts = {
    tech: Department.findByCode('TECH'),
    sales: Department.findByCode('SALES')
  };

  log('失败场景 1: 缺附件 - 提交时没有必要附件');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-001',
      title: '测试缺附件合同',
      amount: 50000,
      department_id: depts.tech.id,
      risk_level: 'low',
      applicant_id: users.zhangsan.id
    });
    
    try {
      await ContractApprovalService.submitContract(contract.id, users.zhangsan.id, '127.0.0.1');
      assert(false, '应该抛出缺少附件错误');
    } catch (e) {
      assert(e.message.includes('缺少必要附件'), '正确提示缺少必要附件');
      log('✓ 正确阻止无附件提交', e.message);
    }
    
    const contractCheck = Contract.findById(contract.id);
    assert(contractCheck.status === 'draft', '合同状态仍为草稿');
  }

  log('失败场景 2: 坏规则 - 引用不存在的角色');
  {
    const badRule = {
      name: '坏规则测试',
      description: '包含不存在角色的规则',
      priority: 100,
      conditions: {
        type: 'simple',
        field: 'amount',
        operator: 'greater_than',
        value: 1
      },
      steps: [
        {
          name: '不存在的角色审批',
          type: 'single',
          required_roles: ['nonexistent_role']
        }
      ]
    };
    
    const validation = RuleEngine.validateRuleSteps(badRule);
    assert(validation.valid === false, '规则验证失败');
    assert(validation.errors.some(e => e.includes('不存在的角色')), '正确识别不存在的角色');
    log('✓ 正确检测到坏规则', validation.errors);
    
    try {
      const createdBadRule = ApprovalRule.create({
        ...badRule,
        created_by: users.admin.id
      });
      
      const testContract = Contract.create({
        contract_no: 'HT-FAIL-002',
        title: '测试坏规则合同',
        amount: 100,
        department_id: depts.tech.id,
        risk_level: 'low',
        applicant_id: users.zhangsan.id
      });
      Contract.addAttachment({
        contract_id: testContract.id,
        file_name: 'test.pdf',
        uploaded_by: users.zhangsan.id,
        is_required: true
      });
      
      await ContractApprovalService.submitContract(testContract.id, users.zhangsan.id, '127.0.0.1');
      assert(false, '应该抛出规则验证错误');
    } catch (e) {
      assert(e.message.includes('不存在的角色'), '提交时检测到坏规则');
      log('✓ 提交时正确拒绝坏规则', e.message);
    }
    
    const allBadRules = ApprovalRule.findAll().filter(r => r.name === '坏规则测试');
    allBadRules.forEach(r => {
      db.prepare('DELETE FROM approval_rules WHERE id = ?').run(r.id);
    });
    db.forceSave();
    db.load();
    log(`✓ 已删除 ${allBadRules.length} 个坏规则版本，避免影响后续测试`);
  }

  log('失败场景 3: 申请人越权审批 - 不能审批自己的合同');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-003',
      title: '测试越权审批合同',
      amount: 500000,
      department_id: depts.tech.id,
      risk_level: 'medium',
      applicant_id: users.zhangsan.id
    });
    Contract.addAttachment({
      contract_id: contract.id,
      file_name: '合同.pdf',
      uploaded_by: users.zhangsan.id,
      is_required: true
    });
    
    await ContractApprovalService.submitContract(contract.id, users.zhangsan.id, '127.0.0.1');
    db.forceSave();
    db.load();
    
    const contractAfter = Contract.findById(contract.id);
    const stepId = contractAfter.current_step_id;
    
    try {
      await ContractApprovalService.processApproval(
        contract.id,
        stepId,
        users.zhangsan.id,
        'approve',
        '自己审批自己',
        null,
        '127.0.0.1'
      );
      assert(false, '应该抛出申请人不能审批的错误');
    } catch (e) {
      assert(e.message.includes('申请人不能审批自己提交的合同'), '正确阻止自审批');
      log('✓ 正确阻止申请人自审批', e.message);
    }
  }

  log('失败场景 4: 越权审批 - 没有对应角色的用户不能审批');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-004',
      title: '测试角色越权合同',
      amount: 500000,
      department_id: depts.tech.id,
      risk_level: 'medium',
      applicant_id: users.lisi.id
    });
    Contract.addAttachment({
      contract_id: contract.id,
      file_name: '合同.pdf',
      uploaded_by: users.lisi.id,
      is_required: true
    });
    
    await ContractApprovalService.submitContract(contract.id, users.lisi.id, '127.0.0.1');
    db.forceSave();
    db.load();
    
    const contractAfter = Contract.findById(contract.id);
    const step = ApprovalStep.findById(contractAfter.current_step_id);
    log('当前步骤', { name: step.step_name, required_roles: step.required_roles });
    
    try {
      await ContractApprovalService.processApproval(
        contract.id,
        step.id,
        users.wangwu.id,
        'approve',
        '财务越权审批部门经理步骤',
        null,
        '127.0.0.1'
      );
      assert(false, '应该抛出越权错误');
    } catch (e) {
      assert(e.message.includes('越权操作'), '正确阻止角色越权');
      log('✓ 正确阻止角色越权审批', e.message);
    }
  }

  log('失败场景 5: 重复提交 - 同一步骤不能重复审批');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-005',
      title: '测试重复提交合同',
      amount: 5000000,
      department_id: depts.tech.id,
      risk_level: 'high',
      applicant_id: users.lisi.id
    });
    Contract.addAttachment({
      contract_id: contract.id,
      file_name: '合同.pdf',
      uploaded_by: users.lisi.id,
      is_required: true
    });
    
    await ContractApprovalService.submitContract(contract.id, users.lisi.id, '127.0.0.1');
    db.forceSave();
    db.load();
    
    let contractAfter = Contract.findById(contract.id);
    let steps = ApprovalStep.findByContract(contract.id);
    
    const step1 = ApprovalStep.findById(contractAfter.current_step_id);
    log('第一步', { name: step1.step_name, type: step1.step_type, required_signatures: step1.required_signatures });
    
    const result1 = await ContractApprovalService.processApproval(
      contract.id,
      step1.id,
      users.zhangsan.id,
      'approve',
      '部门经理审批通过',
      null,
      '127.0.0.1'
    );
    assert(result1.success === true, '第一步审批成功');
    log('✓ 第一步审批成功');
    
    db.forceSave();
    db.load();
    
    contractAfter = Contract.findById(contract.id);
    const step2 = ApprovalStep.findById(contractAfter.current_step_id);
    log('第二步', { name: step2.step_name, type: step2.step_type, required_signatures: step2.required_signatures });
    
    const result2 = await ContractApprovalService.processApproval(
      contract.id,
      step2.id,
      users.wangwu.id,
      'approve',
      '财务审批通过',
      null,
      '127.0.0.1'
    );
    assert(result2.success === true, '会签第一步成功');
    log('✓ 会签第一步成功 - 财务签字');
    
    try {
      await ContractApprovalService.processApproval(
        contract.id,
        step2.id,
        users.wangwu.id,
        'approve',
        '财务重复签字',
        null,
        '127.0.0.1'
      );
      assert(false, '应该抛出重复提交错误');
    } catch (e) {
      assert(e.message.includes('已对此步骤进行过审批'), '正确阻止重复提交');
      log('✓ 正确阻止重复提交', e.message);
    }
  }

  log('失败场景 6: 错误状态操作 - 非审批状态不能审批');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-006',
      title: '测试状态错误合同',
      amount: 500000,
      department_id: depts.tech.id,
      risk_level: 'medium',
      applicant_id: users.lisi.id
    });
    Contract.addAttachment({
      contract_id: contract.id,
      file_name: '合同.pdf',
      uploaded_by: users.lisi.id,
      is_required: true
    });
    
    const fakeStep = ApprovalStep.create({
      contract_id: contract.id,
      step_order: 1,
      step_name: '测试步骤',
      step_type: 'single',
      required_roles: ['finance'],
      required_signatures: 1
    });
    
    try {
      await ContractApprovalService.processApproval(
        contract.id,
        fakeStep.id,
        users.wangwu.id,
        'approve',
        '草稿状态审批',
        null,
        '127.0.0.1'
      );
      assert(false, '应该抛出状态错误');
    } catch (e) {
      assert(e.message.includes('不允许审批'), '正确阻止错误状态操作');
      log('✓ 正确阻止错误状态操作', e.message);
    }
  }

  log('失败场景 7: 提交补件时没有附件');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-007',
      title: '测试补件无附件',
      amount: 500000,
      department_id: depts.tech.id,
      risk_level: 'medium',
      applicant_id: users.lisi.id
    });
    Contract.addAttachment({
      contract_id: contract.id,
      file_name: '合同.pdf',
      uploaded_by: users.lisi.id,
      is_required: true
    });
    
    await ContractApprovalService.submitContract(contract.id, users.lisi.id, '127.0.0.1');
    db.forceSave();
    db.load();
    
    let contractAfter = Contract.findById(contract.id);
    const step1 = ApprovalStep.findById(contractAfter.current_step_id);
    await ContractApprovalService.processApproval(
      contract.id,
      step1.id,
      users.zhangsan.id,
      'approve',
      '同意',
      null,
      '127.0.0.1'
    );
    db.forceSave();
    db.load();
    
    contractAfter = Contract.findById(contract.id);
    const step2 = ApprovalStep.findById(contractAfter.current_step_id);
    await ContractApprovalService.processApproval(
      contract.id,
      step2.id,
      users.wangwu.id,
      'request_supplement',
      '请补件',
      null,
      '127.0.0.1'
    );
    db.forceSave();
    db.load();
    
    try {
      await ContractApprovalService.submitSupplement(
        contract.id,
        users.lisi.id,
        [],
        '没有附件的补件',
        '127.0.0.1'
      );
      assert(false, '应该抛出缺少附件错误');
    } catch (e) {
      assert(e.message.includes('请上传补件附件'), '正确要求补件附件');
      log('✓ 正确要求补件必须上传附件', e.message);
    }
  }

  log('失败场景 8: 归档验证 - 只能归档已批准的合同');
  {
    const contract = Contract.create({
      contract_no: 'HT-FAIL-008',
      title: '测试错误归档',
      amount: 50000,
      department_id: depts.tech.id,
      risk_level: 'low',
      applicant_id: users.zhangsan.id
    });
    
    try {
      await ContractApprovalService.archiveContract(contract.id, users.admin.id, '127.0.0.1');
      assert(false, '应该抛出状态错误');
    } catch (e) {
      assert(e.message.includes('不允许归档'), '正确阻止错误归档');
      log('✓ 正确阻止错误状态归档', e.message);
    }
  }

  log('失败场景 9: 规则版本变更验证');
  {
    const oldRule = ApprovalRule.findByName('中风险中等金额合同');
    assert(oldRule.version === 1, '初始规则版本为1');
    
    const newRule = ApprovalRule.create({
      name: '中风险中等金额合同',
      description: '版本2 - 修改了审批流程',
      priority: 20,
      conditions: oldRule.conditions,
      steps: [
        { name: '部门经理审批', type: 'single', required_roles: ['department_manager'] },
        { name: '财务审核', type: 'single', required_roles: ['finance'] },
        { name: '风控审核', type: 'single', required_roles: ['risk'] },
        { name: '法务审核', type: 'single', required_roles: ['legal'] }
      ],
      created_by: users.admin.id
    });
    
    assert(newRule.version === 2, '新规则版本为2');
    log('✓ 规则版本自动递增', { old: oldRule.version, new: newRule.version });
    
    const allVersions = ApprovalRule.findAll().filter(r => r.name === '中风险中等金额合同');
    assert(allVersions.length === 2, '保留所有历史版本');
    log('✓ 保留规则历史版本', allVersions.map(r => ({ id: r.id, version: r.version })));
  }

  console.log('\n========================================');
  console.log('  ✅ 失败路径验收测试全部通过！');
  console.log('========================================\n');
  
  console.log('\n已验证的失败场景:');
  console.log('  ✓ 缺附件提交被阻止');
  console.log('  ✓ 坏规则(引用不存在角色)被检测');
  console.log('  ✓ 申请人不能审批自己的合同');
  console.log('  ✓ 角色越权审批被阻止');
  console.log('  ✓ 同一步骤重复提交被阻止');
  console.log('  ✓ 错误状态操作被阻止');
  console.log('  ✓ 补件必须上传附件');
  console.log('  ✓ 只能归档已批准合同');
  console.log('  ✓ 规则版本变更保留历史');
}

if (require.main === module) {
  runFailureTests().catch(err => {
    console.error('测试失败:', err);
    process.exit(1);
  });
}

module.exports = runFailureTests;
