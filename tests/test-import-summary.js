const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const ApprovalRule = require('../src/models/ApprovalRule');
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

function createTestRule(name, priority, amountValue) {
  return {
    name: name,
    description: '变更摘要测试规则',
    priority: priority,
    conditions: {
      type: 'composite',
      logic: 'AND',
      conditions: [
        { type: 'simple', field: 'amount', operator: 'greater_than_or_equal', value: amountValue },
        { type: 'simple', field: 'risk_level', operator: 'equals', value: 'medium' }
      ]
    },
    steps: [
      { name: '部门经理审批', type: 'single', required_roles: ['department_manager'] },
      { name: '财务审核', type: 'single', required_roles: ['finance'] }
    ]
  };
}

function getUniqueBasePriority() {
  const ApprovalRule = require('../src/models/ApprovalRule');
  const activeRules = ApprovalRule.findAllActive();
  const maxPriority = activeRules.length > 0 ? Math.max(...activeRules.map(r => r.priority)) : 0;
  return maxPriority + 10000;
}

async function runTests() {
  console.log('\n========================================');
  console.log('  规则导入变更摘要 综合测试');
  console.log('========================================\n');

  const users = {};
  User.findAll().forEach(u => { users[u.username] = u; });

  const timestamp = Date.now();
  const TEST_PREFIX = '变更摘要测试-';
  const BASE_PRIORITY = getUniqueBasePriority();
  console.log('  使用基础优先级:', BASE_PRIORITY);

  log('1. 测试权限控制 - 普通用户拒绝');
  
  const importNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [] }, REGULAR_USER_ID);
  assert(importNoAuth.status === 403, '普通用户不能导入规则');

  const previewNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [] }, REGULAR_USER_ID);
  assert(previewNoAuth.status === 403, '普通用户不能使用预检模式');

  log('2. 测试新增规则 (change_type: create)');
  
  const newRuleName = TEST_PREFIX + '新增规则-' + timestamp;
  const newRule = createTestRule(newRuleName, BASE_PRIORITY + 1, 500001);
  
  const createPreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [newRule] });
  
  assert(createPreview.status === 200, '新增规则预检成功');
  assert(createPreview.data.summary.create === 1, '摘要显示1条新增');
  assert(createPreview.data.rules[0].change_type === 'create', 'change_type 为 create');
  assert(createPreview.data.rules[0].name === newRuleName, '规则名称正确');
  assert(createPreview.data.rules[0].current_version === null, '当前版本为 null');
  assert(createPreview.data.rules[0].new_version === 1, '新版本为 1');
  assert(createPreview.data.rules[0].should_audit === true, '需要审计');
  console.log('  预检摘要:', JSON.stringify(createPreview.data.summary));

  log('3. 测试正式导入返回批次号');
  
  const importRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [newRule] });
  
  assert(importRes.status === 200, '正式导入成功');
  assert(importRes.data.success === true, '导入成功标记');
  assert(importRes.data.batch_id !== undefined, '返回批次号');
  assert(importRes.data.batch_id.length > 0, '批次号非空');
  assert(importRes.data.summary.create === 1, '摘要显示1条新增');
  assert(importRes.data.imported === 1, '导入数量正确');
  assert(importRes.data.results[0].change_type === 'create', '结果中 change_type 正确');
  console.log('  批次号:', importRes.data.batch_id);

  reloadDb();
  const importedRule = ApprovalRule.findByName(newRuleName);
  assert(importedRule !== null, '导入的规则可以在数据库中找到');
  assert(importedRule.version === 1, '版本号为1');

  log('4. 测试无变化规则 (change_type: no_change)');
  
  const noChangePreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [newRule] });
  
  assert(noChangePreview.status === 200, '无变化规则预检成功');
  assert(noChangePreview.data.summary.no_change === 1, '摘要显示1条无变化');
  assert(noChangePreview.data.rules[0].change_type === 'no_change', 'change_type 为 no_change');
  assert(noChangePreview.data.rules[0].current_version === 1, '当前版本为1');
  assert(noChangePreview.data.rules[0].new_version === 2, '新版本为2');
  assert(noChangePreview.data.rules[0].should_audit === false, '默认不需要审计');
  assert(Object.keys(noChangePreview.data.rules[0].field_diff).length === 0, '字段差异为空');
  console.log('  预检摘要:', JSON.stringify(noChangePreview.data.summary));

  log('5. 测试无变化规则正式导入 - 默认跳过');
  
  const noChangeImport = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [newRule] });
  
  assert(noChangeImport.status === 200, '无变化规则导入成功');
  assert(noChangeImport.data.skipped === 1, '跳过1条无变化规则');
  assert(noChangeImport.data.imported === 0, '实际导入0条');
  assert(noChangeImport.data.results[0].skipped === true, '结果标记为跳过');
  assert(noChangeImport.data.results[0].reason === '无变化，未创建新版本', '跳过原因正确');
  
  reloadDb();
  const noChangeRule = ApprovalRule.findByName(newRuleName);
  assert(noChangeRule.version === 1, '版本号仍为1，未创建新版本');

  log('6. 测试更新规则 (change_type: update)');
  
  const updatedRule = {
    ...newRule,
    description: '更新后的描述',
    priority: BASE_PRIORITY + 2
  };
  
  const updatePreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [updatedRule] });
  
  assert(updatePreview.status === 200, '更新规则预检成功');
  assert(updatePreview.data.summary.update === 1, '摘要显示1条更新');
  assert(updatePreview.data.rules[0].change_type === 'update', 'change_type 为 update');
  assert(updatePreview.data.rules[0].field_diff.description !== undefined, '检测到 description 变更');
  assert(updatePreview.data.rules[0].field_diff.priority !== undefined, '检测到 priority 变更');
  assert(updatePreview.data.rules[0].field_diff.description.old === newRule.description, '旧值正确');
  assert(updatePreview.data.rules[0].field_diff.description.new === '更新后的描述', '新值正确');
  assert(updatePreview.data.rules[0].field_diff.priority.old === BASE_PRIORITY + 1, '旧优先级正确');
  assert(updatePreview.data.rules[0].field_diff.priority.new === BASE_PRIORITY + 2, '新优先级正确');
  console.log('  字段差异:', JSON.stringify(updatePreview.data.rules[0].field_diff));

  const updateImport = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [updatedRule] });
  
  assert(updateImport.status === 200, '更新规则导入成功');
  assert(updateImport.data.summary.update === 1, '摘要显示1条更新');
  assert(updateImport.data.results[0].change_type === 'update', '结果 change_type 正确');
  assert(updateImport.data.results[0].previous_active_version === 1, '之前活跃版本为1');
  
  reloadDb();
  const updatedRuleDb = ApprovalRule.findByName(newRuleName);
  assert(updatedRuleDb.version === 2, '版本号更新为2');
  assert(updatedRuleDb.description === '更新后的描述', '描述已更新');

  log('7. 测试优先级冲突 (change_type: priority_conflict)');
  
  reloadDb();
  const activeRules = ApprovalRule.findAllActive();
  const existingPriority = activeRules[0].priority;
  const conflictRuleName = TEST_PREFIX + '优先级冲突-' + timestamp;
  const conflictRule = createTestRule(conflictRuleName, existingPriority, 600001);
  
  const conflictPreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [conflictRule] });
  
  assert(conflictPreview.status === 200, '优先级冲突预检成功');
  assert(conflictPreview.data.summary.priority_conflict === 1, '摘要显示1条优先级冲突');
  assert(conflictPreview.data.rules[0].change_type === 'priority_conflict', 'change_type 为 priority_conflict');
  assert(conflictPreview.data.rules[0].conflict_details !== null, '包含冲突详情');
  assert(conflictPreview.data.rules[0].conflict_details.type === 'priority_conflict', '冲突类型正确');
  assert(conflictPreview.data.rules[0].conflict_details.conflicting_priority === existingPriority, '冲突优先级正确');
  assert(conflictPreview.data.rules[0].conflict_details.conflicting_rule_name === activeRules[0].name, '冲突规则名称正确');
  assert(conflictPreview.data.warnings.length > 0, '包含警告信息');
  assert(conflictPreview.data.warnings[0].includes('优先级') && conflictPreview.data.warnings[0].includes('冲突'), '警告信息正确');
  console.log('  冲突详情:', JSON.stringify(conflictPreview.data.rules[0].conflict_details));

  log('8. 测试导入文件内重名 (change_type: duplicate_name)');
  
  const dupName1 = TEST_PREFIX + '重名测试-' + timestamp;
  const dupRule1 = createTestRule(dupName1, BASE_PRIORITY + 3, 700001);
  const dupRule2 = createTestRule(dupName1, BASE_PRIORITY + 4, 800001);
  
  const dupPreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [dupRule1, dupRule2] });
  
  assert(dupPreview.status === 400, '重名导入返回400');
  assert(dupPreview.data.can_import === false, '不能导入');
  assert(dupPreview.data.summary.duplicate_name === 2, '摘要显示2条重名');
  assert(dupPreview.data.rules[0].change_type === 'duplicate_name', 'change_type 为 duplicate_name');
  assert(dupPreview.data.rules[0].conflict_details.type === 'duplicate_name_in_import', '冲突类型正确');
  assert(dupPreview.data.errors.length > 0, '包含错误信息');
  assert(dupPreview.data.errors[0].includes('重名'), '错误信息包含重名');
  console.log('  重名错误:', dupPreview.data.errors[0]);

  log('9. 测试校验失败 (change_type: validation_failed)');
  
  const invalidRuleName = TEST_PREFIX + '校验失败-' + timestamp;
  const invalidRule = {
    ...createTestRule(invalidRuleName, BASE_PRIORITY + 5, 900001),
    steps: [
      { name: '无效步骤', type: 'single', required_roles: ['invalid_role'] }
    ]
  };
  
  const invalidPreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [invalidRule] });
  
  assert(invalidPreview.status === 400, '校验失败返回400');
  assert(invalidPreview.data.summary.validation_failed === 1, '摘要显示1条校验失败');
  assert(invalidPreview.data.rules[0].change_type === 'validation_failed', 'change_type 为 validation_failed');
  assert(invalidPreview.data.rules[0].validation_errors.length > 0, '包含校验错误');
  const hasInvalidRoleError = invalidPreview.data.rules[0].validation_errors.some(e =>
    e.includes('无效角色') || e.includes('不存在的角色') || e.includes('invalid_role')
  );
  assert(hasInvalidRoleError, '错误信息包含无效角色相关内容');
  console.log('  校验错误:', invalidPreview.data.rules[0].validation_errors[0]);

  log('10. 测试混合导入 - 多种变更类型');
  
  const mixedRule1 = createTestRule(TEST_PREFIX + '混合-新增-' + timestamp, BASE_PRIORITY + 10, 100001);
  const mixedRule2 = {
    ...updatedRule,
    description: '混合导入时再次更新的描述',
    priority: BASE_PRIORITY + 11
  };
  const mixedRule3 = createTestRule(TEST_PREFIX + '混合-冲突-' + timestamp, existingPriority, 300001);
  
  const mixedPreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [mixedRule1, mixedRule2, mixedRule3] });
  
  assert(mixedPreview.status === 200, '混合预检成功');
  assert(mixedPreview.data.summary.create === 1, '摘要显示1条新增');
  assert(mixedPreview.data.summary.update === 1, '摘要显示1条更新');
  assert(mixedPreview.data.summary.priority_conflict === 1, '摘要显示1条优先级冲突');
  assert(mixedPreview.data.total === 3, '总计3条规则');
  console.log('  各规则变更类型:');
  mixedPreview.data.rules.forEach(r => console.log(`    - ${r.name}: ${r.change_type}`));
  console.log('  混合摘要:', JSON.stringify(mixedPreview.data.summary));

  log('11. 测试审计日志记录变更类型和批次号');
  
  const auditRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs?limit=50',
    method: 'GET'
  });
  
  assert(auditRes.status === 200, '获取审计日志成功');
  const importLogs = auditRes.data.filter(l => l.action === 'rule_import');
  assert(importLogs.length >= 2, '至少有2条导入审计日志');
  
  const lastImportLog = importLogs[0];
  let newValue = lastImportLog.new_value;
  if (typeof newValue === 'string') {
    newValue = JSON.parse(newValue);
  }
  assert(newValue.change_type !== undefined, '审计日志包含 change_type');
  assert(newValue.batch_id !== undefined, '审计日志包含 batch_id');
  assert(newValue.field_diff !== undefined, '审计日志包含 field_diff');
  console.log('  审计日志 change_type:', newValue.change_type);
  console.log('  审计日志批次号:', newValue.batch_id);

  log('12. 测试无变化规则默认不写审计日志');
  
  const auditLogsAfterNoChange = auditRes.data.filter(l => {
    let nv = l.new_value;
    if (typeof nv === 'string') nv = JSON.parse(nv);
    return nv && nv.name === newRuleName && nv.change_type === 'no_change';
  });
  assert(auditLogsAfterNoChange.length === 0, '无变化规则默认不写入审计日志');

  log('13. 测试正式导入返回的摘要与预检一致');
  
  const testRuleName = TEST_PREFIX + '一致性测试-' + timestamp;
  const testRule = createTestRule(testRuleName, BASE_PRIORITY + 20, 1100001);
  
  const previewForConsistency = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [testRule] });
  
  const importForConsistency = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [testRule] });
  
  assert(JSON.stringify(previewForConsistency.data.summary) === JSON.stringify(importForConsistency.data.summary), '预检和正式导入摘要一致');
  assert(previewForConsistency.data.rules[0].change_type === importForConsistency.data.rules[0].change_type, '预检和正式导入 change_type 一致');
  console.log('  预检摘要:', JSON.stringify(previewForConsistency.data.summary));
  console.log('  导入摘要:', JSON.stringify(importForConsistency.data.summary));

  log('14. 测试服务重启后规则版本可查询');
  
  reloadDb();
  const ruleAfterReload = ApprovalRule.findByName(newRuleName);
  assert(ruleAfterReload !== null, '重启后规则仍存在');
  assert(ruleAfterReload.version === 2, '重启后版本号正确');
  console.log('  重启后规则版本:', ruleAfterReload.version);

  log('15. 测试服务重启后审计记录可查询');
  
  const auditAfterReload = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs?limit=100',
    method: 'GET'
  });
  
  const logsAfterReload = auditAfterReload.data.filter(l => l.action === 'rule_import');
  assert(logsAfterReload.length >= 2, '重启后审计记录仍存在');
  console.log('  重启后审计记录数量:', logsAfterReload.length);

  console.log('\n========================================');
  console.log('  ✅ 所有变更摘要测试通过！');
  console.log('========================================\n');
  
  console.log('请重启服务后运行持久性验证测试:');
  console.log('  node tests/test-import-summary-persistence.js', newRuleName, importRes.data.batch_id);
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
