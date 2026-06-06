const db = require('../src/database/db');
const seedData = require('../src/seeders/seed');
const Contract = require('../src/models/Contract');
const Department = require('../src/models/Department');
const User = require('../src/models/User');
const ApprovalStep = require('../src/models/ApprovalStep');
const ContractApprovalService = require('../src/services/ContractApprovalService');

async function debug() {
  console.log('=== 调试 test-flow.js 失败原因 ===\n');
  
  await seedData(true);
  
  const deptTech = Department.findByCode('TECH');
  const users = {
    zhangsan: User.findByUsername('zhangsan'),
    qianshiyi: User.findByUsername('qianshiyi')
  };
  
  const contract = Contract.create({
    contract_no: 'HT-DEBUG-001',
    title: '调试合同',
    amount: 2000000,
    department_id: deptTech.id,
    risk_level: 'medium',
    content: '调试内容',
    applicant_id: users.zhangsan.id
  });
  
  Contract.addAttachment({
    contract_id: contract.id,
    file_name: '附件1.pdf',
    file_path: '/files/attach1.pdf',
    uploaded_by: users.zhangsan.id,
    is_required: true
  });
  
  console.log('提交审批前合同状态:', contract.status);
  
  const submitResult = await ContractApprovalService.submitContract(
    contract.id,
    users.zhangsan.id,
    '127.0.0.1'
  );
  
  console.log('\n提交审批后:');
  console.log('合同 current_step_id:', Contract.findById(contract.id).current_step_id);
  
  const steps = ApprovalStep.findByContract(contract.id);
  console.log('\n所有步骤:');
  steps.forEach(function(s) {
    console.log('  id=' + s.id + ', order=' + s.step_order + ', name=' + s.step_name + ', status=' + s.status);
  });
  
  console.log('\n调用 ApprovalStep.findPendingByContract:');
  const pendingStep = ApprovalStep.findPendingByContract(contract.id);
  console.log('结果:', pendingStep ? 'id=' + pendingStep.id + ', name=' + pendingStep.step_name : 'null');
  
  console.log('\n调用 ApprovalStep.findByContract(contract.id)[0]:');
  const firstStep = ApprovalStep.findByContract(contract.id)[0];
  console.log('结果:', firstStep ? 'id=' + firstStep.id + ', name=' + firstStep.step_name : 'null');
  
  console.log('\n--- 实际步骤匹配检查 ---');
  console.log('contract.current_step_id:', Contract.findById(contract.id).current_step_id);
  console.log('pendingStep.id:', pendingStep ? pendingStep.id : 'null');
  console.log('是否匹配:', pendingStep && pendingStep.id === Contract.findById(contract.id).current_step_id);
  
  console.log('\n--- 用单行 SQL 测试 findPendingByContract ---');
  const rows = db.prepare(
    "SELECT * FROM approval_steps WHERE contract_id = ? AND status = 'pending' ORDER BY step_order LIMIT 1"
  ).all(contract.id);
  console.log('单行SQL查询结果:', rows.length > 0 ? 'id=' + rows[0].id : 'null');
  
  console.log('\n--- 用多行 SQL 测试 ---');
  const rows2 = db.prepare(`
    SELECT * FROM approval_steps 
    WHERE contract_id = ? AND status = 'pending'
    ORDER BY step_order LIMIT 1
  `).all(contract.id);
  console.log('多行SQL查询结果:', rows2.length > 0 ? 'id=' + rows2[0].id : 'null');
}

debug().catch(err => {
  console.error(err);
  process.exit(1);
});
