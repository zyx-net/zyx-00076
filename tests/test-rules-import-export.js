const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const ApprovalRule = require('../src/models/ApprovalRule');
const Contract = require('../src/models/Contract');

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

async function runTests() {
  console.log('\n========================================');
  console.log('  规则导入导出与回滚 回归测试');
  console.log('========================================\n');

  const users = {};
  User.findAll().forEach(u => { users[u.username] = u; });
  const depts = {};
  Department.findAll().forEach(d => { depts[d.code] = d; });

  log('1. 测试普通用户权限拒绝');
  
  const exportNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  }, null, REGULAR_USER_ID);
  assert(exportNoAuth.status === 403, '普通用户不能导出规则');

  const importNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [] }, REGULAR_USER_ID);
  assert(importNoAuth.status === 403, '普通用户不能导入规则');

  const rollbackNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/TestRule/rollback/1',
    method: 'POST'
  }, { reason: '测试' }, REGULAR_USER_ID);
  assert(rollbackNoAuth.status === 403, '普通用户不能回滚规则');

  const auditNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs',
    method: 'GET'
  }, null, REGULAR_USER_ID);
  assert(auditNoAuth.status === 403, '普通用户不能查看全局审计日志');

  log('2. 测试导出功能');
  
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  assert(exportRes.status === 200, '管理员可以导出规则');
  assert(exportRes.data.rules !== undefined, '导出数据包含 rules 字段');
  assert(exportRes.data.exported_at !== undefined, '导出数据包含导出时间');
  assert(exportRes.data.version === '1.0', '导出格式版本正确');
  
  const exportedRules = exportRes.data.rules;
  console.log('  导出规则数量:', exportedRules.length);
  assert(exportedRules.length > 0, '至少导出一条规则');
  
  for (const rule of exportedRules) {
    assert(rule.name !== undefined, '导出规则包含 name');
    assert(rule.version !== undefined, '导出规则包含 version');
    assert(rule.conditions !== undefined, '导出规则包含 conditions');
    assert(rule.steps !== undefined, '导出规则包含 steps');
    assert(rule.priority !== undefined, '导出规则包含 priority');
    assert(Array.isArray(rule.steps), 'steps 是数组');
    assert(typeof rule.conditions === 'object', 'conditions 是对象');
  }

  log('3. 测试导入预检模式 (preview=true)');
  
  const uniqueAmount = 1000000 + Math.floor(Math.random() * 1000000);
  const allRules = ApprovalRule.findAllActive();
  const maxPriority = allRules.length > 0 ? Math.max(...allRules.map(r => r.priority)) : 0;
  const testRulePriority = maxPriority + 1000;
  console.log('  使用优先级:', testRulePriority, '(最高现有优先级:', maxPriority + ')');
  
  const testRule = {
    name: '回归测试规则-' + Date.now(),
    description: '用于回归测试的规则',
    priority: testRulePriority,
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

  const previewRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [testRule] });
  
  assert(previewRes.status === 200, '预检模式返回200');
  assert(previewRes.data.preview === true, '响应标记为预览模式');
  assert(previewRes.data.can_import === true, '可以导入');
  assert(previewRes.data.differences[0].action === 'create', '识别为新建规则');
  assert(previewRes.data.differences[0].name === testRule.name, '规则名称匹配');

  log('4. 测试导入冲突检测 - 重名');
  
  const duplicateNameRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [testRule, testRule] });
  assert(duplicateNameRes.status === 400, '导入重复名称返回400');
  assert(duplicateNameRes.data.errors.some(e => e.includes('重名')), '检测到重名错误');

  log('5. 测试导入冲突检测 - 无效角色');
  
  const invalidRoleRule = {
    ...testRule,
    name: '无效角色测试规则',
    steps: [
      { name: '测试步骤', type: 'single', required_roles: ['invalid_role'] }
    ]
  };
  
  const invalidRoleRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [invalidRoleRule] });
  assert(invalidRoleRes.status === 400, '导入无效角色返回400');
  assert(invalidRoleRes.data.errors.some(e => e.includes('无效角色')), '检测到无效角色错误');

  log('6. 测试正式导入');
  
  const importRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [testRule] });
  
  assert(importRes.status === 200, '正式导入成功');
  assert(importRes.data.success === true, '导入成功标记');
  assert(importRes.data.imported === 1, '导入数量正确');
  assert(importRes.data.results[0].name === testRule.name, '导入规则名称正确');
  assert(importRes.data.results[0].version === 1, '新版本号为1');

  reloadDb();
  const importedRule = ApprovalRule.findByName(testRule.name);
  assert(importedRule !== null, '导入的规则可以在数据库中找到');
  assert(importedRule.is_active === 1, '导入的规则已激活');
  assert(importedRule.priority === testRulePriority, '优先级正确');

  log('7. 测试导出再导入一致性');
  
  const exportRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  const exportedTestRule = exportRes2.data.rules.find(r => r.name === testRule.name);
  assert(exportedTestRule !== null, '导出的数据包含新导入的规则');
  assert(exportedTestRule.priority === testRulePriority, '导出的优先级与导入一致');
  assert(JSON.stringify(exportedTestRule.conditions) === JSON.stringify(testRule.conditions), '导出的条件与导入一致');
  assert(JSON.stringify(exportedTestRule.steps) === JSON.stringify(testRule.steps), '导出的步骤与导入一致');

  log('8. 测试导入新版本 - 保留旧版本');
  
  const modifiedRule = {
    ...testRule,
    description: '修改后的规则描述',
    priority: testRulePriority + 100
  };
  
  const importRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [modifiedRule] });
  
  assert(importRes2.status === 200, '导入新版本成功');
  assert(importRes2.data.results[0].version === 2, '新版本号为2');
  assert(importRes2.data.results[0].previous_active_version === 1, '记录了之前的活跃版本');

  reloadDb();
  const allVersions = ApprovalRule.findAllVersionsByName(testRule.name);
  assert(allVersions.length === 2, '规则有2个版本');
  assert(allVersions[0].version === 2, '最新版本是v2');
  assert(allVersions[0].is_active === 1, 'v2是活跃状态');
  assert(allVersions[1].version === 1, '旧版本是v1');
  assert(allVersions[1].is_active === 0, 'v1已被停用');

  log('9. 测试规则版本列表');
  
  const versionsRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${testRule.name}/versions`,
    method: 'GET'
  });
  assert(versionsRes.status === 200, '获取版本列表成功');
  assert(versionsRes.data.length === 2, '返回2个版本');

  log('10. 测试版本回滚');
  
  const rollbackRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${testRule.name}/rollback/1`,
    method: 'POST'
  }, { reason: '回归测试回滚到v1' });
  
  assert(rollbackRes.status === 200, '回滚成功');
  assert(rollbackRes.data.rolled_back_from === 2, '从v2回滚');
  assert(rollbackRes.data.rolled_back_to === 1, '回滚到v1');
  assert(rollbackRes.data.new_version === 3, '新版本号为v3');

  reloadDb();
  const rolledBackRule = ApprovalRule.findByName(testRule.name);
  assert(rolledBackRule.version === 3, '当前活跃版本是v3');
  assert(rolledBackRule.priority === testRulePriority, '回滚后优先级恢复为' + testRulePriority);
  assert(rolledBackRule.description === testRule.description, '回滚后描述恢复');

  log('11. 测试回滚原因不能为空');
  
  const rollbackNoReason = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${testRule.name}/rollback/1`,
    method: 'POST'
  }, { reason: '' });
  assert(rollbackNoReason.status === 400, '回滚原因不能为空');

  log('12. 测试审批中合同不受规则变更影响');
  
  const contractNo = 'HT-REG-' + Date.now();
  const contractRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: contractNo,
    title: '回归测试合同',
    amount: uniqueAmount + 1000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: '测试合同内容',
    attachments: [{
      file_name: '测试附件.pdf',
      file_path: '/files/test.pdf',
      is_required: true
    }]
  }, users.zhangsan.id);
  
  assert(contractRes.status === 201, '合同创建成功');
  const contract = contractRes.data;

  const submitRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}/submit`,
    method: 'POST'
  }, {}, users.zhangsan.id);
  
  assert(submitRes.status === 200, '合同提交成功');
  const originalRuleVersion = submitRes.data.rule.version;
  const originalRuleId = submitRes.data.rule.id;
  const originalRuleName = submitRes.data.rule.name;
  console.log('  合同匹配规则名称:', originalRuleName, '版本:', originalRuleVersion, 'ID:', originalRuleId);
  console.log('  期望规则名称:', testRule.name);

  const modifiedRule2 = {
    ...testRule,
    priority: testRulePriority + 200,
    steps: [
      { name: '修改后的步骤1', type: 'single', required_roles: ['ceo'] },
      { name: '修改后的步骤2', type: 'single', required_roles: ['admin'] }
    ]
  };
  
  await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [modifiedRule2] });

  const currentStepRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}/current-step`,
    method: 'GET'
  });
  
  assert(currentStepRes.status === 200, '获取当前步骤成功');
  assert(currentStepRes.data.step.name === '部门经理审批', '审批中合同的步骤不受规则变更影响');
  
  const contractAfter = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}`,
    method: 'GET'
  });
  
  assert(contractAfter.data.rule_version === originalRuleVersion, '合同绑定的规则版本不变');
  assert(contractAfter.data.rule_id === originalRuleId, '合同绑定的规则ID不变');

  log('13. 测试回滚后新提交合同使用新规则');
  
  const newContractNo = 'HT-REG2-' + Date.now();
  const newContractRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: newContractNo,
    title: '回滚后新合同',
    amount: uniqueAmount + 2000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: '测试回滚后的新合同',
    attachments: [{
      file_name: '测试附件2.pdf',
      file_path: '/files/test2.pdf',
      is_required: true
    }]
  }, users.lisi.id);
  
  const newContract = newContractRes.data;
  
  const submitNewRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${newContract.id}/submit`,
    method: 'POST'
  }, {}, users.lisi.id);
  
  assert(submitNewRes.status === 200, '新合同提交成功');
  assert(submitNewRes.data.rule.version === 4, '新合同使用最新版本v4');

  log('14. 测试持久性检查');
  
  const persistRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/persistence-check',
    method: 'GET'
  });
  
  assert(persistRes.status === 200, '持久性检查成功');
  assert(persistRes.data.status === 'ok', '所有持久性检查通过');
  assert(persistRes.data.checks.db_file_exists === true, '数据库文件存在');
  assert(persistRes.data.checks.save_consistent === true, '数据一致');
  assert(persistRes.data.checks.last_save_timeout === true, '没有待处理的保存');
  assert(persistRes.data.checks.pending_transactions === 0, '没有待处理的事务');

  log('15. 测试审计日志记录');
  
  const auditRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs?limit=50',
    method: 'GET'
  });
  
  assert(auditRes.status === 200, '获取审计日志成功');
  const logs = auditRes.data;
  
  const exportLogs = logs.filter(l => l.action === 'rules_export');
  assert(exportLogs.length >= 1, '有规则导出的审计日志');
  
  const importLogs = logs.filter(l => l.action === 'rule_import');
  assert(importLogs.length >= 3, '有规则导入的审计日志');
  
  const rollbackLogs = logs.filter(l => l.action === 'rule_rollback');
  assert(rollbackLogs.length >= 1, '有规则回滚的审计日志');
  const rollbackNewValue = typeof rollbackLogs[0].new_value === 'string' ? JSON.parse(rollbackLogs[0].new_value) : rollbackLogs[0].new_value;
  assert(rollbackNewValue.reason === '回归测试回滚到v1', '回滚日志包含原因');

  log('16. 测试普通用户看不到敏感审计字段');
  
  const contractAuditRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}/audit-logs`,
    method: 'GET'
  }, null, REGULAR_USER_ID);
  
  assert(contractAuditRes.status === 200, '普通用户可以查看合同审计日志');
  for (const log of contractAuditRes.data) {
    assert(log.old_value === undefined, '普通用户看不到 old_value');
    assert(log.new_value === undefined, '普通用户看不到 new_value');
    assert(log.ip_address === undefined, '普通用户看不到 ip_address');
  }

  const contractAuditAdmin = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}/audit-logs`,
    method: 'GET'
  }, null, ADMIN_USER_ID);
  
  assert(contractAuditAdmin.status === 200, '管理员可以查看合同审计日志');
  let hasSensitive = false;
  for (const log of contractAuditAdmin.data) {
    if (log.old_value !== undefined || log.new_value !== undefined) {
      hasSensitive = true;
      break;
    }
  }
  assert(hasSensitive, '管理员可以看到敏感字段');

  log('17. 测试导入优先级冲突警告');
  
  reloadDb();
  const activeRules = ApprovalRule.findAllActive();
  if (activeRules.length >= 2) {
    const existingPriority = activeRules[0].priority;
    const conflictRule = {
      name: '优先级冲突测试-' + Date.now(),
      priority: existingPriority,
      conditions: {
        type: 'simple',
        field: 'amount',
        operator: 'greater_than_or_equal',
        value: 999999
      },
      steps: [
        { name: '测试步骤', type: 'single', required_roles: ['admin'] }
      ]
    };
    
    const conflictRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/rules/import?preview=true',
      method: 'POST'
    }, { rules: [conflictRule] });
    
    assert(conflictRes.status === 200, '优先级冲突预检成功');
    assert(conflictRes.data.warnings.some(w => w.includes('优先级') && w.includes('冲突')), '检测到优先级冲突警告');
  } else {
    console.log('  跳过：活跃规则不足2条，无法测试优先级冲突');
  }

  log('18. 测试导入预检模式 - 识别变更字段');
  
  const modifiedRule3 = {
    ...testRule,
    priority: testRulePriority + 500,
    description: '预检测试修改描述',
    steps: [
      { name: '预检测试步骤1', type: 'single', required_roles: ['admin'] },
      { name: '预检测试步骤2', type: 'single', required_roles: ['ceo'] }
    ]
  };
  
  const previewRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [modifiedRule3] });
  
  assert(previewRes2.status === 200, '预检模式识别变更成功');
  const diff = previewRes2.data.differences.find(d => d.name === testRule.name);
  assert(diff !== null, '找到差异记录');
  assert(diff.action === 'update', '识别为更新操作');
  assert(diff.changes.includes('steps'), '识别到steps变更');
  assert(diff.changes.includes('priority'), '识别到priority变更');
  assert(diff.changes.includes('description'), '识别到description变更');

  console.log('\n========================================');
  console.log('  ✅ 所有回归测试通过！');
  console.log('========================================\n');
  
  console.log('请重启服务后运行持久性验证测试:');
  console.log('  node tests/test-persistence-restart.js', contract.id, testRule.name);
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
