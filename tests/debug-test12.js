const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const ApprovalRule = require('../src/models/ApprovalRule');
const Contract = require('../src/models/Contract');

db.load();

const ADMIN_USER_ID = User.findByUsername('admin').id;
const zhangsan = User.findByUsername('zhangsan');
const depts = {};
for (const d of Department.findAll()) {
  depts[d.code] = d;
}

const testRule = {
  name: '回归测试规则-' + Date.now(),
  description: '回归测试创建的规则',
  priority: 999,
  conditions: {
    type: 'composite',
    logic: 'AND',
    conditions: [
      { type: 'simple', field: 'amount', operator: 'greater_than_or_equal', value: 10000 },
      { type: 'simple', field: 'risk_level', operator: 'equals', value: 'medium' }
    ]
  },
  steps: [
    { name: '部门经理审批', type: 'single', required_roles: ['department_manager'] },
    { name: '财务审核', type: 'single', required_roles: ['finance'] }
  ]
};

function makeRequest(options, body = null, userId = ADMIN_USER_ID) {
  const headers = options.headers || {};
  headers['x-user-id'] = userId;
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  options.headers = headers;
  
  if (options.path) {
    const [basePath, queryString] = options.path.split('?');
    options.path = encodeURI(basePath) + (queryString ? '?' + queryString : '');
  }
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  console.log('Test rule name:', testRule.name);
  
  // Import v1
  const import1 = await makeRequest({
    hostname: 'localhost', port: 3000, path: '/api/rules/import', method: 'POST'
  }, { rules: [testRule] });
  console.log('Import v1:', import1.status, 'version:', import1.data.results?.[0]?.version);
  
  // Import v2
  const modifiedRule = { ...testRule, description: 'v2', priority: 1000 };
  const import2 = await makeRequest({
    hostname: 'localhost', port: 3000, path: '/api/rules/import', method: 'POST'
  }, { rules: [modifiedRule] });
  console.log('Import v2:', import2.status, 'version:', import2.data.results?.[0]?.version);
  
  // Rollback to v1 -> creates v3
  const rollback = await makeRequest({
    hostname: 'localhost', port: 3000, 
    path: `/api/rules/${testRule.name}/rollback/1`, method: 'POST'
  }, { reason: 'test' });
  console.log('Rollback:', rollback.status, 'new_version:', rollback.data.new_version);
  
  // Create contract
  const contractNo = 'HT-DEBUG-' + Date.now();
  const contractRes = await makeRequest({
    hostname: 'localhost', port: 3000, path: '/api/contracts', method: 'POST'
  }, {
    contract_no: contractNo,
    title: 'Debug contract',
    amount: 50000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: 'test',
    attachments: [{ file_name: 'test.pdf', file_path: '/test.pdf', is_required: true }]
  }, zhangsan.id);
  console.log('Create contract:', contractRes.status);
  const contract = contractRes.data;
  
  // Submit contract
  const submitRes = await makeRequest({
    hostname: 'localhost', port: 3000, 
    path: `/api/contracts/${contract.id}/submit`, method: 'POST'
  }, {}, zhangsan.id);
  console.log('Submit contract:', submitRes.status, 'rule version:', submitRes.data.rule?.version);
  console.log('Rule matched:', JSON.stringify(submitRes.data.rule, null, 2));
  
  // Now modify the rule to v4 with different steps
  const modifiedRule2 = {
    ...testRule,
    priority: 2000,
    steps: [
      { name: '修改后的步骤1', type: 'single', required_roles: ['ceo'] },
      { name: '修改后的步骤2', type: 'single', required_roles: ['admin'] }
    ]
  };
  
  const import3 = await makeRequest({
    hostname: 'localhost', port: 3000, path: '/api/rules/import', method: 'POST'
  }, { rules: [modifiedRule2] });
  console.log('Import v3 (modifying):', import3.status, 'new version:', import3.data.results?.[0]?.version);
  
  // Check current step of submitted contract
  const currentStep = await makeRequest({
    hostname: 'localhost', port: 3000, 
    path: `/api/contracts/${contract.id}/current-step`, method: 'GET'
  });
  console.log('Current step:', JSON.stringify(currentStep.data, null, 2));
  
  // Check what steps are stored in approval_steps table for this contract
  db.load();
  const steps = db.prepare('SELECT * FROM approval_steps WHERE contract_id = ? ORDER BY step_order').all(contract.id);
  console.log('Stored approval steps:', JSON.stringify(steps, null, 2));
  
  // Check contract's rule binding
  const contractCheck = Contract.findById(contract.id);
  console.log('Contract rule binding:', {
    rule_id: contractCheck.rule_id,
    rule_version: contractCheck.rule_version
  });
  
  const boundRule = ApprovalRule.findById(contractCheck.rule_id);
  console.log('Bound rule:', {
    name: boundRule.name,
    version: boundRule.version,
    steps: boundRule.steps
  });
}

runTest().catch(err => console.error(err));
