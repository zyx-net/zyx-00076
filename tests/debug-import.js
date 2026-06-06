const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const ApprovalRule = require('../src/models/ApprovalRule');

db.load();

const ADMIN_USER_ID = User.findByUsername('admin').id;

const uniqueAmount = 1000000 + Math.floor(Math.random() * 1000000);
const testRule = {
  name: '回归测试规则-' + Date.now(),
  description: '用于回归测试的规则',
  priority: 99999,
  conditions: {
    type: 'composite',
    logic: 'AND',
    conditions: [
      { type: 'simple', field: 'amount', operator: 'greater_than_or_equal', value: uniqueAmount },
      { type: 'simple', field: 'risk_level', operator: 'equals', value: 'medium' }
    ]
  },
  steps: [
    { name: '部门经理审批', type: 'single', required_roles: ['department_manager'] },
    { name: '财务审核', type: 'single', required_roles: ['finance'] }
  ]
};

console.log('Test rule priority:', testRule.priority);
console.log('Test rule name:', testRule.name);

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
  const importRes = await makeRequest({
    hostname: 'localhost', port: 3000, path: '/api/rules/import', method: 'POST'
  }, { rules: [testRule] });
  
  console.log('Import response:', JSON.stringify(importRes, null, 2));
  
  db.load();
  const importedRule = ApprovalRule.findByName(testRule.name);
  console.log('Imported rule from DB:', {
    name: importedRule.name,
    priority: importedRule.priority,
    version: importedRule.version
  });
}

runTest().catch(err => console.error(err));
