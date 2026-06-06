const http = require('http');
const User = require('../src/models/User');
const Contract = require('../src/models/Contract');
const ApprovalRule = require('../src/models/ApprovalRule');
const db = require('../src/database/db');

db.load();

const ADMIN_USER_ID = User.findByUsername('admin').id;

const contracts = Contract.findAll();
const latestContract = contracts[contracts.length - 1];
console.log('Latest contract:', latestContract.contract_no, 'status:', latestContract.status);
console.log('rule_id:', latestContract.rule_id, 'rule_version:', latestContract.rule_version);

const rule = ApprovalRule.findById(latestContract.rule_id);
console.log('Matched rule name:', rule.name, 'version:', rule.version);
console.log('Rule steps:', JSON.stringify(rule.steps, null, 2));

const approvalSteps = db.prepare('SELECT * FROM approval_steps WHERE contract_id = ? ORDER BY step_order').all(latestContract.id);
console.log('Contract approval steps:', JSON.stringify(approvalSteps, null, 2));

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/contracts/' + latestContract.id + '/current-step',
  method: 'GET',
  headers: {
    'x-user-id': ADMIN_USER_ID,
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const stepData = JSON.parse(data);
    console.log('Current step from API:', JSON.stringify(stepData, null, 2));
  });
});
req.end();
