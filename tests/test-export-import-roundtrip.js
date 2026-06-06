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

let passed = 0;
let failed = 0;
const failures = [];

function log(msg) {
  console.log(`  ${msg}`);
}

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`❌ 断言失败: ${message}`);
  }
}

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
          resolve({ status: res.statusCode, data: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n========================================');
  console.log('  导出再导入 往返一致性测试');
  console.log('========================================\n');

  // ========================================
  // 准备：创建一个测试专用规则
  // ========================================
  console.log('=== 准备：创建测试专用规则 ===\n');
  
  reloadDb();
  const allRules = ApprovalRule.findAllActive();
  const maxPriority = allRules.length > 0 ? Math.max(...allRules.map(r => r.priority)) : 0;
  const testRulePriority = maxPriority + 5000;
  const uniqueAmount = 2000000 + Math.floor(Math.random() * 1000000);
  
  const testRule = {
    name: '往返测试规则-' + Date.now(),
    description: '用于导出再导入往返测试的规则',
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
      { name: '往返测试步骤1', type: 'single', required_roles: ['department_manager'] },
      { name: '往返测试步骤2', type: 'single', required_roles: ['finance'] }
    ]
  };
  
  console.log(`  测试规则: ${testRule.name}`);
  console.log(`  优先级: ${testRulePriority}`);
  console.log(`  金额阈值: ${uniqueAmount}\n`);
  
  const importRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [testRule] });
  
  assert(importRes.status === 200, '测试规则创建成功');
  assert(importRes.data.success === true, '导入返回成功标记');
  assert(importRes.data.imported === 1, '导入数量为1');
  
  reloadDb();
  const createdRule = ApprovalRule.findByName(testRule.name);
  assert(createdRule !== null, '创建的规则存在');
  assert(createdRule.version === 1, '创建的规则版本为1');
  assert(createdRule.priority === testRulePriority, '优先级正确');

  // ========================================
  // 测试 1: 管理员导出规则
  // ========================================
  console.log('\n=== 1. 测试管理员导出规则 ===\n');
  
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  assert(exportRes.status === 200, '导出接口返回200');
  assert(exportRes.data.exported_at !== undefined, '导出数据包含 exported_at');
  assert(exportRes.data.exported_by !== undefined, '导出数据包含 exported_by');
  assert(exportRes.data.exported_by_name !== undefined, '导出数据包含 exported_by_name');
  assert(exportRes.data.version !== undefined, '导出数据包含格式版本');
  assert(Array.isArray(exportRes.data.rules), '导出数据包含 rules 数组');
  
  const exportedTestRule = exportRes.data.rules.find(r => r.name === testRule.name);
  assert(exportedTestRule !== null, '导出数据包含测试规则');
  assert(exportedTestRule.version === 1, '导出的规则版本为1');
  assert(exportedTestRule.is_active === 1, '导出的规则 is_active 为1');
  assert(exportedTestRule.created_at !== undefined, '导出的规则包含 created_at');
  assert(exportedTestRule.created_by !== undefined, '导出的规则包含 created_by');
  assert(exportedTestRule.priority === testRulePriority, '导出的优先级正确');
  assert(JSON.stringify(exportedTestRule.conditions) === JSON.stringify(testRule.conditions), '导出的条件正确');
  assert(JSON.stringify(exportedTestRule.steps) === JSON.stringify(testRule.steps), '导出的步骤正确');
  
  console.log(`  导出了 ${exportRes.data.rules.length} 条规则`);
  console.log(`  测试规则导出成功，版本: ${exportedTestRule.version}`);

  // ========================================
  // 测试 2: 普通用户导出被拒绝
  // ========================================
  console.log('\n=== 2. 测试普通用户导出被拒绝 ===\n');
  
  const exportRegularRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  }, null, REGULAR_USER_ID);
  
  assert(exportRegularRes.status === 403, '普通用户导出返回403');
  assert(exportRegularRes.data.error.includes('管理员'), '错误信息提示需要管理员权限');

  // ========================================
  // 测试 3: 原样导入预检（完整导出格式）
  // ========================================
  console.log('\n=== 3. 测试原样导入预检（完整导出格式） ===\n');
  
  // 修改导出的规则，制造差异
  const modifiedExport = JSON.parse(exportRes.raw);
  const testRuleInExport = modifiedExport.rules.find(r => r.name === testRule.name);
  testRuleInExport.description = testRule.description + '（修改过）';
  const modifiedExportRaw = JSON.stringify(modifiedExport);
  
  const previewRes1 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, modifiedExportRaw);
  
  assert(previewRes1.status === 200, '完整导出格式导入预检返回200（不再被Joi拒绝）');
  assert(previewRes1.data.preview === true, '响应包含 preview 标记');
  assert(previewRes1.data.can_import === true, '响应包含 can_import 标记');
  
  const testRuleDiff = previewRes1.data.differences.find(d => d.name === testRule.name);
  assert(testRuleDiff !== null, '预检结果包含测试规则');
  assert(testRuleDiff.action === 'update', '识别为更新操作');
  assert(testRuleDiff.current_version === 1, '当前版本为1');
  assert(testRuleDiff.new_version === 2, '新版本为2');
  assert(testRuleDiff.changes.includes('description'), '识别到description变更');
  
  const hasWarning = previewRes1.data.warnings.some(w => w.includes(testRule.name) && w.includes('名称已存在'));
  assert(hasWarning === true, '预检返回重名警告');
  
  console.log(`  预检成功，识别 ${previewRes1.data.differences.length} 条规则差异`);

  // ========================================
  // 测试 4: 普通用户导入被拒绝
  // ========================================
  console.log('\n=== 4. 测试普通用户导入被拒绝 ===\n');
  
  const importRegularRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, exportRes.raw, REGULAR_USER_ID);
  
  assert(importRegularRes.status === 403, '普通用户导入返回403');
  assert(importRegularRes.data.error.includes('管理员'), '错误信息提示需要管理员权限');

  // ========================================
  // 测试 5: 正式导入完整导出格式
  // ========================================
  console.log('\n=== 5. 测试正式导入完整导出格式 ===\n');
  
  // 获取导入前的审计日志数量
  reloadDb();
  const auditLogsBefore = AuditLog.findAll(1000);
  const importLogsBefore = auditLogsBefore.filter(l => l.action === 'rule_import').length;
  
  const importFullRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, modifiedExportRaw);
  
  assert(importFullRes.status === 200, '正式导入完整导出格式返回200');
  assert(importFullRes.data.success === true, '导入成功');
  
  const testRuleResult = importFullRes.data.results.find(r => r.name === testRule.name);
  assert(testRuleResult !== null, '导入结果包含测试规则');
  assert(testRuleResult.version === 2, '导入后版本号自动递增为2');
  assert(testRuleResult.previous_active_version === 1, '记录了之前的活跃版本');
  
  // 验证版本号自动生成，不是使用导出的version=1
  reloadDb();
  const allVersions = ApprovalRule.findAllVersionsByName(testRule.name);
  assert(allVersions.length === 2, '数据库中存在2个版本');
  assert(allVersions[0].version === 2, '最新版本为2');
  assert(allVersions[1].version === 1, '历史版本为1');
  assert(allVersions[0].is_active === 1, 'v2是活跃版本');
  assert(allVersions[1].is_active === 0, 'v1已被停用');
  
  // 验证新版本的created_by是当前操作用户，不是导出的created_by
  assert(allVersions[0].created_by === ADMIN_USER_ID, '新版本created_by是当前操作用户');
  assert(allVersions[0].created_at > exportedTestRule.created_at, '新版本created_at是新的时间戳');
  
  // 验证审计日志已记录
  reloadDb();
  const auditLogsAfter = AuditLog.findAll(1000);
  const importLogsAfter = auditLogsAfter.filter(l => l.action === 'rule_import').length;
  assert(importLogsAfter > importLogsBefore, '导入后审计日志增加');
  
  const testRuleImportLogs = auditLogsAfter.filter(l => {
    if (l.action !== 'rule_import' || !l.new_value) return false;
    const newValue = typeof l.new_value === 'string' ? JSON.parse(l.new_value) : l.new_value;
    return newValue.name === testRule.name && newValue.version === 2;
  });
  assert(testRuleImportLogs.length > 0, '存在测试规则的导入审计日志');
  const logNewValue = typeof testRuleImportLogs[0].new_value === 'string' ? JSON.parse(testRuleImportLogs[0].new_value) : testRuleImportLogs[0].new_value;
  assert(logNewValue.name === testRule.name, '审计日志包含规则名称');
  assert(logNewValue.version === 2, '审计日志记录新版本号');
  assert(logNewValue.description === testRuleInExport.description, '审计日志记录修改后的描述');
  
  console.log(`  导入成功，规则版本从v1升级到v2`);
  console.log(`  审计日志已记录`);

  // ========================================
  // 测试 6: 审批中合同不受导入影响
  // ========================================
  console.log('\n=== 6. 测试审批中合同不受导入影响 ===\n');
  
  const users = {};
  for (const u of User.findAll()) { users[u.username] = u; }
  const depts = {};
  for (const d of Department.findAll()) { depts[d.code] = d; }
  
  // 创建并提交合同（使用v2版本的规则）
  const contractNo = 'HT-RT-' + Date.now();
  const contractRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: contractNo,
    title: '往返测试合同',
    amount: uniqueAmount + 1000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: '测试审批中合同不受导入影响',
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
  assert(submitRes.data.rule.version === 2, '合同匹配规则版本v2');
  const boundRuleId = submitRes.data.rule.id;
  const boundRuleVersion = submitRes.data.rule.version;
  
  // 获取合同当前审批步骤
  const currentStepRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}/current-step`,
    method: 'GET'
  });
  assert(currentStepRes.status === 200, '获取当前步骤成功');
  const originalStepName = currentStepRes.data.step.name;
  assert(originalStepName === testRule.steps[0].name, '当前步骤名称正确');
  
  console.log(`  合同提交，绑定规则v2，当前步骤: ${originalStepName}`);
  
  // 再次导入（创建v3）- 再修改一下制造差异
  const modifiedExport3 = JSON.parse(modifiedExportRaw);
  const testRuleInExport3 = modifiedExport3.rules.find(r => r.name === testRule.name);
  testRuleInExport3.description = testRuleInExport3.description + '（再次修改）';
  const modifiedExportRaw3 = JSON.stringify(modifiedExport3);
  
  const importV3Res = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, modifiedExportRaw3);
  
  assert(importV3Res.status === 200, '再次导入成功');
  const v3Result = importV3Res.data.results.find(r => r.name === testRule.name);
  assert(v3Result.version === 3, '导入后版本号为v3');
  
  // 验证审批中合同的步骤没有改变
  const currentStepRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract.id}/current-step`,
    method: 'GET'
  });
  assert(currentStepRes2.status === 200, '再次获取当前步骤成功');
  assert(currentStepRes2.data.step.name === originalStepName, '审批中合同的步骤未被改变');
  
  reloadDb();
  const contractCheck = Contract.findById(contract.id);
  assert(contractCheck.rule_id === boundRuleId, '合同绑定的rule_id未变');
  assert(contractCheck.rule_version === boundRuleVersion, '合同绑定的rule_version未变');
  
  console.log(`  再次导入创建v3，审批中合同仍使用v2，步骤未变`);

  // ========================================
  // 测试 7: 新提交合同使用最新版本
  // ========================================
  console.log('\n=== 7. 测试新提交合同使用最新版本 ===\n');
  
  const contractNo2 = 'HT-RT2-' + Date.now();
  const contractRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: contractNo2,
    title: '往返测试新合同',
    amount: uniqueAmount + 2000,
    department_id: depts.TECH.id,
    risk_level: 'medium',
    content: '测试新合同使用最新规则版本',
    attachments: [{
      file_name: '测试附件2.pdf',
      file_path: '/files/test2.pdf',
      is_required: true
    }]
  }, users.lisi.id);
  
  assert(contractRes2.status === 201, '新合同创建成功');
  const contract2 = contractRes2.data;
  
  const submitRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contract2.id}/submit`,
    method: 'POST'
  }, {}, users.lisi.id);
  
  assert(submitRes2.status === 200, '新合同提交成功');
  assert(submitRes2.data.rule.version === 3, '新合同匹配最新版本v3');
  
  console.log(`  新合同提交，匹配规则v3`);

  // ========================================
  // 测试 8: 导入时重名和优先级冲突提示
  // ========================================
  console.log('\n=== 8. 测试导入时重名和优先级冲突提示 ===\n');
  
  // 创建一个新规则，使用相同的优先级
  const conflictingRule = {
    name: '冲突测试规则-' + Date.now(),
    description: '测试优先级冲突',
    priority: testRulePriority,
    conditions: {
      type: 'composite',
      logic: 'AND',
      conditions: [
        { type: 'simple', field: 'amount', operator: 'greater_than_or_equal', value: uniqueAmount + 5000 },
        { type: 'simple', field: 'risk_level', operator: 'equals', value: 'high' }
      ]
    },
    steps: [
      { name: '冲突测试步骤', type: 'single', required_roles: ['ceo'] }
    ]
  };
  
  const conflictImportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [conflictingRule] });
  
  assert(conflictImportRes.status === 200, '冲突规则预检成功');
  const hasPriorityWarning = conflictImportRes.data.warnings.some(w => 
    w.includes('优先级') && w.includes(testRulePriority.toString())
  );
  assert(hasPriorityWarning === true, '预检返回优先级冲突警告');
  
  // 测试导入的规则中存在重名
  const duplicateNameImport = {
    rules: [testRule, testRule]
  };
  const duplicateRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, duplicateNameImport);
  
  assert(duplicateRes.status === 400, '导入数据内部重名返回400');
  assert(duplicateRes.data.errors.some(e => e.includes('重名')), '错误信息包含重名提示');
  
  console.log(`  重名和优先级冲突提示正常`);

  // ========================================
  // 测试 9: 导出->导出文件->再导入 一致性
  // ========================================
  console.log('\n=== 9. 测试导出文件保存后再导入 ===\n');
  
  // 保存导出结果到文件
  const exportFilePath = path.join(__dirname, `../data/export-test-${Date.now()}.json`);
  fs.writeFileSync(exportFilePath, exportRes.raw, 'utf8');
  
  // 从文件读取并导入
  const fileContent = fs.readFileSync(exportFilePath, 'utf8');
  const fileImportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, fileContent);
  
  assert(fileImportRes.status === 200, '从文件读取的导出数据可成功预检');
  
  // 清理文件
  fs.unlinkSync(exportFilePath);
  
  console.log(`  导出文件保存后再导入正常`);

  // ========================================
  // 测试 10: 只传rules数组也可以导入（向后兼容）
  // ========================================
  console.log('\n=== 10. 测试只传rules数组也可以导入（向后兼容） ===\n');
  
  const rulesOnlyImport = {
    rules: exportRes.data.rules.slice(0, 1)
  };
  
  const rulesOnlyRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, rulesOnlyImport);
  
  assert(rulesOnlyRes.status === 200, '只传rules数组也可以导入');
  
  console.log(`  向后兼容：只传rules数组正常工作`);

  // ========================================
  // 测试 11: 跨服务重启持久化验证
  // ========================================
  console.log('\n=== 11. 测试跨服务重启持久化验证 ===\n');
  
  const persistenceRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/persistence-check',
    method: 'GET'
  });
  
  assert(persistenceRes.status === 200, '持久性检查接口返回200');
  assert(persistenceRes.data.status === 'ok' || persistenceRes.data.status === 'warning', '持久性检查返回状态');
  assert(persistenceRes.data.checks.db_file_exists === true, '数据库文件存在');
  assert(persistenceRes.data.checks.save_consistent === true, '内存与文件数据一致');
  
  reloadDb();
  const ruleAfterReload = ApprovalRule.findByName(testRule.name);
  assert(ruleAfterReload !== null, '重启后测试规则仍可读取');
  assert(ruleAfterReload.version === 3, '重启后规则版本为v3');
  assert(ruleAfterReload.is_active === 1, '重启后规则仍为激活状态');
  assert(JSON.stringify(ruleAfterReload.conditions) === JSON.stringify(testRule.conditions), '重启后条件一致');
  assert(JSON.stringify(ruleAfterReload.steps) === JSON.stringify(testRule.steps), '重启后步骤一致');
  
  const exportAfterReloadRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  assert(exportAfterReloadRes.status === 200, '重启后导出功能正常');
  const exportedAfterReload = exportAfterReloadRes.data.rules.find(r => r.name === testRule.name);
  assert(exportedAfterReload !== null, '重启后导出包含测试规则');
  assert(exportedAfterReload.version === 3, '重启后导出版本正确');
  
  console.log(`  持久化验证通过，测试规则: ${testRule.name}, 版本: v3`);
  console.log(`  请重启服务后运行: node tests/test-export-import-restart.js ${testRule.name}`);

  // ========================================
  // 测试总结
  // ========================================
  console.log('\n========================================');
  console.log('  测试完成');
  console.log('========================================');
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed}`);
  
  if (failed > 0) {
    console.log('\n  失败的测试:');
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('\n  ✅ 所有测试通过！');
  }
}

runTests().catch(err => {
  console.error('测试执行出错:', err);
  process.exit(1);
});
