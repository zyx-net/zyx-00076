const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const ApprovalRule = require('../src/models/ApprovalRule');
const Contract = require('../src/models/Contract');
const AuditLog = require('../src/models/AuditLog');

function reloadDb() {
  db.load();
}

const ADMIN_USER_ID = User.findByUsername('admin').id;
const REGULAR_USER_ID = User.findByUsername('zhangsan').id;

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
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  if (data !== undefined) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error('\n❌ 断言失败:', message);
    process.exit(1);
  }
  console.log('✅', message);
}

const args = process.argv.slice(2);
const contractId = args[0];
const ruleName = args[1];

if (!contractId || !ruleName) {
  console.error('用法: node tests/test-persistence-restart.js <contractId> <ruleName>');
  process.exit(1);
}

async function runPersistenceTest() {
  console.log('\n========================================');
  console.log('  跨服务重启 持久性验证测试');
  console.log('========================================\n');

  reloadDb();

  log('1. 验证数据库文件存在且可读取');
  
  const dbPath = path.resolve(__dirname, '../data/db.json');
  assert(fs.existsSync(dbPath), '数据库文件存在');
  
  const fileData = fs.readFileSync(dbPath, 'utf8');
  const parsedData = JSON.parse(fileData);
  assert(parsedData.users && parsedData.users.length > 0, '数据库包含用户数据');
  assert(parsedData.approval_rules && parsedData.approval_rules.length > 0, '数据库包含规则数据');
  assert(parsedData.contracts && parsedData.contracts.length > 0, '数据库包含合同数据');

  log('2. 验证内存数据与文件数据一致');
  
  assert(JSON.stringify(db.data.users) === JSON.stringify(parsedData.users), '内存用户数据与文件一致');
  assert(JSON.stringify(db.data.approval_rules) === JSON.stringify(parsedData.approval_rules), '内存规则数据与文件一致');
  assert(JSON.stringify(db.data.contracts) === JSON.stringify(parsedData.contracts), '内存合同数据与文件一致');

  log('3. 验证之前创建的合同数据持久化');
  
  const contract = Contract.findById(contractId);
  assert(contract !== null, '合同数据持久化成功');
  assert(contract.rule_id !== null, '合同绑定的规则ID持久化');
  assert(contract.rule_version !== null, '合同绑定的规则版本持久化');
  assert(contract.status === 'approving', '合同状态持久化');

  log('4. 验证之前创建的规则数据持久化');
  
  const rule = ApprovalRule.findByName(ruleName);
  assert(rule !== null, '规则数据持久化成功');
  assert(rule.is_active === 1, '规则活跃状态持久化');
  assert(rule.conditions !== null, '规则条件持久化');
  assert(rule.steps !== null, '规则步骤持久化');
  assert(rule.priority !== null, '规则优先级持久化');

  log('5. 验证规则版本历史持久化');
  
  const allVersions = ApprovalRule.findAllVersionsByName(ruleName);
  assert(allVersions.length >= 3, '规则版本历史持久化');
  console.log('  规则版本数:', allVersions.length);
  
  for (let i = 0; i < allVersions.length; i++) {
    const v = allVersions[i];
    assert(v.version === allVersions.length - i, `版本 v${v.version} 存在`);
  }

  log('6. 验证审计日志持久化');
  
  const auditLogs = AuditLog.findAll(100);
  assert(auditLogs.length > 0, '审计日志持久化');
  
  const importLogs = auditLogs.filter(l => l.action === 'rule_import');
  assert(importLogs.length >= 3, '规则导入日志持久化');
  
  const rollbackLogs = auditLogs.filter(l => l.action === 'rule_rollback');
  assert(rollbackLogs.length >= 1, '规则回滚日志持久化');

  log('7. 测试重启后新合同提交使用最新规则');
  
  const users = {};
  User.findAll().forEach(u => { users[u.username] = u; });
  const depts = {};
  Department.findAll().forEach(d => { depts[d.code] = d; });

  reloadDb();
  const testRule = ApprovalRule.findByName(ruleName);
  let minAmount = 10000;
  try {
    if (testRule.conditions.type === 'composite' && testRule.conditions.conditions) {
      for (const cond of testRule.conditions.conditions) {
        if (cond.field === 'amount' && cond.operator === 'greater_than_or_equal') {
          minAmount = cond.value;
          break;
        }
      }
    }
  } catch (e) {
    console.log('  使用默认金额阈值');
  }
  console.log('  规则金额阈值:', minAmount);

  const contractNo = 'HT-PERSIST-' + Date.now();
  const contractRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: contractNo,
    title: '持久性测试新合同',
    amount: minAmount + 5000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: '重启后的新合同',
    attachments: [{
      file_name: '持久化测试附件.pdf',
      file_path: '/files/persist-test.pdf',
      is_required: true
    }]
  }, users.lisi.id);
  
  assert(contractRes.status === 201, '重启后可以创建合同');
  const newContract = contractRes.data;

  const submitRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${newContract.id}/submit`,
    method: 'POST'
  }, {}, users.lisi.id);
  
  assert(submitRes.status === 200, '重启后可以提交合同');
  assert(submitRes.data.rule.name === ruleName, '新合同使用正确的规则');
  assert(submitRes.data.rule.version === 4, '新合同使用最新版本v4');

  log('8. 测试持久性检查接口');
  
  const persistRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/persistence-check',
    method: 'GET'
  });
  
  assert(persistRes.status === 200, '持久性检查接口可用');
  assert(persistRes.data.status === 'ok', '所有持久性检查通过');
  assert(persistRes.data.checks.save_consistent === true, '数据一致');

  log('9. 测试导出功能在重启后仍然正常');
  
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  assert(exportRes.status === 200, '重启后导出功能正常');
  const exportedRule = exportRes.data.rules.find(r => r.name === ruleName);
  assert(exportedRule !== null, '导出数据包含测试规则');
  assert(exportedRule.version === 4, '导出的是最新版本');

  log('10. 验证历史版本回滚记录持久化');
  
  const versionsRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${ruleName}/versions`,
    method: 'GET'
  });
  
  assert(versionsRes.status === 200, '可以获取规则版本列表');
  assert(versionsRes.data.length >= 3, '版本列表完整');
  
  const v1 = versionsRes.data.find(v => v.version === 1);
  const v2 = versionsRes.data.find(v => v.version === 2);
  const v3 = versionsRes.data.find(v => v.version === 3);
  const v4 = versionsRes.data.find(v => v.version === 4);
  
  assert(v1 !== undefined, 'v1版本存在');
  assert(v2 !== undefined, 'v2版本存在');
  assert(v3 !== undefined, 'v3版本存在');
  assert(v4 !== undefined, 'v4版本存在');
  
  assert(v4.is_active === 1, 'v4是活跃版本');
  assert(v1.is_active === 0, 'v1已停用');
  assert(v2.is_active === 0, 'v2已停用');
  assert(v3.is_active === 0, 'v3已停用');

  log('11. 验证审批中合同不受重启影响');
  
  const currentStepRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractId}/current-step`,
    method: 'GET'
  });
  
  assert(currentStepRes.status === 200, '可以获取审批中合同的当前步骤');
  assert(currentStepRes.data.step.name === '部门经理审批', '合同审批步骤不受重启影响');
  assert(currentStepRes.data.status === 'approving', '合同状态仍然是审批中');

  log('12. 验证回滚后重新提交合同使用新规则');
  
  const rollbackRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${ruleName}/rollback/1`,
    method: 'POST'
  }, { reason: '持久性测试回滚到v1' });
  
  assert(rollbackRes.status === 200, '重启后可以回滚规则');
  assert(rollbackRes.data.new_version === 5, '新版本号为v5');

  const contractNo2 = 'HT-PERSIST2-' + Date.now();
  const contractRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: contractNo2,
    title: '回滚后新合同',
    amount: minAmount + 15000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: '回滚后的新合同',
    attachments: [{
      file_name: '回滚测试附件.pdf',
      file_path: '/files/rollback-test.pdf',
      is_required: true
    }]
  }, users.lisi.id);
  
  const newContract2 = contractRes2.data;
  
  const submitRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${newContract2.id}/submit`,
    method: 'POST'
  }, {}, users.lisi.id);
  
  assert(submitRes2.status === 200, '回滚后可以提交新合同');
  assert(submitRes2.data.rule.version === 5, '新合同使用回滚后的v5版本');

  db.forceSave();

  console.log('\n========================================');
  console.log('  ✅ 跨服务重启持久性验证测试通过！');
  console.log('========================================\n');
  
  console.log('\n所有测试完成！建议再次重启服务并验证数据完整性。');
}

runPersistenceTest().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
