const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');
const User = require('../src/models/User');
const ApprovalRule = require('../src/models/ApprovalRule');
const AuditLog = require('../src/models/AuditLog');
const ImportBatch = require('../src/models/ImportBatch');

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
    description: '批次追踪测试规则',
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
  const activeRules = ApprovalRule.findAllActive();
  const maxPriority = activeRules.length > 0 ? Math.max(...activeRules.map(r => r.priority)) : 0;
  return maxPriority + 10000;
}

async function runTests() {
  console.log('\n========================================');
  console.log('  导入批次可追踪性 综合测试');
  console.log('========================================\n');

  const users = {};
  User.findAll().forEach(u => { users[u.username] = u; });

  const timestamp = Date.now();
  const TEST_PREFIX = '批次追踪测试-';
  const BASE_PRIORITY = getUniqueBasePriority();
  console.log('  使用基础优先级:', BASE_PRIORITY);

  log('1. 测试权限控制 - 普通用户拒绝');
  
  const listBatchesNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches',
    method: 'GET'
  }, null, REGULAR_USER_ID);
  assert(listBatchesNoAuth.status === 403, '普通用户不能查看批次列表');

  const detailBatchNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches/fake-id',
    method: 'GET'
  }, null, REGULAR_USER_ID);
  assert(detailBatchNoAuth.status === 403, '普通用户不能查看批次详情');

  const undoBatchNoAuth = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches/fake-id/undo',
    method: 'POST'
  }, null, REGULAR_USER_ID);
  assert(undoBatchNoAuth.status === 403, '普通用户不能撤销批次');

  log('2. 测试预检模式不落批次');
  
  const newRuleName = TEST_PREFIX + '新增规则-' + timestamp;
  const newRule = createTestRule(newRuleName, BASE_PRIORITY + 1, 500001);
  
  const batchesBeforePreview = ImportBatch.findAll({ limit: 1000 });
  const batchCountBefore = batchesBeforePreview.length;
  console.log(`  预检前批次数量: ${batchCountBefore}`);

  const createPreview = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, { rules: [newRule] });
  
  assert(createPreview.status === 200, '新增规则预检成功');
  assert(createPreview.data.batch_id === undefined, '预检不返回批次号');
  assert(createPreview.data.summary.create === 1, '摘要显示1条新增');

  reloadDb();
  const batchesAfterPreview = ImportBatch.findAll({ limit: 1000 });
  assert(batchesAfterPreview.length === batchCountBefore, '预检模式不创建批次记录');
  console.log(`  预检后批次数量: ${batchesAfterPreview.length} (未变化)`);

  log('3. 测试正式导入落批次');
  
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
  const batchId = importRes.data.batch_id;
  console.log('  批次号:', batchId);

  reloadDb();
  const batchesAfterImport = ImportBatch.findAll({ limit: 1000 });
  assert(batchesAfterImport.length === batchCountBefore + 1, '正式导入创建批次记录');
  
  const createdBatch = batchesAfterImport.find(b => b.id === batchId);
  assert(createdBatch !== undefined, '可以通过ID找到批次');
  assert(createdBatch.user_id === ADMIN_USER_ID, '批次记录包含操作者ID');
  assert(createdBatch.user_name === '系统管理员', '批次记录包含操作者姓名');
  assert(createdBatch.summary.create === 1, '批次摘要包含新增计数');
  assert(createdBatch.config_switches.auditNoChange === false, '批次记录包含配置开关状态');
  assert(createdBatch.undo_status === 'none', '初始撤销状态为 none');
  assert(createdBatch.rules_summary.length === 1, '批次记录包含规则级差异');
  assert(createdBatch.rules_summary[0].name === newRuleName, '规则名称正确');
  assert(createdBatch.rules_summary[0].change_type === 'create', '变更类型正确');
  console.log('  批次创建时间:', new Date(createdBatch.created_at).toLocaleString());
  console.log('  批次操作者:', createdBatch.user_name);

  log('4. 测试批次列表查询与筛选');
  
  const listRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches?limit=10',
    method: 'GET'
  });
  assert(listRes.status === 200, '获取批次列表成功');
  assert(Array.isArray(listRes.data), '返回数组');
  assert(listRes.data.length >= 1, '至少有1个批次');
  assert(listRes.data[0].id !== undefined, '列表项包含ID');
  assert(listRes.data[0].user_name !== undefined, '列表项包含操作者姓名');
  assert(listRes.data[0].summary !== undefined, '列表项包含摘要');
  assert(listRes.data[0].undo_status !== undefined, '列表项包含撤销状态');
  console.log(`  列表返回 ${listRes.data.length} 个批次`);

  const filteredByUser = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/batches?user_id=${ADMIN_USER_ID}&limit=10`,
    method: 'GET'
  });
  assert(filteredByUser.status === 200, '按用户筛选成功');
  assert(filteredByUser.data.every(b => b.user_id === ADMIN_USER_ID), '所有批次属于指定用户');

  const filteredByStatus = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches?undo_status=none&limit=10',
    method: 'GET'
  });
  assert(filteredByStatus.status === 200, '按状态筛选成功');
  assert(filteredByStatus.data.every(b => b.undo_status === 'none'), '所有批次状态为 none');

  log('5. 测试批次详情查询');
  
  const detailRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/batches/${batchId}`,
    method: 'GET'
  });
  assert(detailRes.status === 200, '获取批次详情成功');
  assert(detailRes.data.id === batchId, '批次ID正确');
  assert(detailRes.data.user_id === ADMIN_USER_ID, '操作者ID正确');
  assert(detailRes.data.user_name === '系统管理员', '操作者姓名正确');
  assert(detailRes.data.created_at > 0, '创建时间正确');
  assert(detailRes.data.summary.create === 1, '摘要正确');
  assert(detailRes.data.rules_summary.length === 1, '规则摘要正确');
  assert(detailRes.data.results.length === 1, '导入结果正确');
  assert(detailRes.data.config_switches.auditNoChange === false, '配置开关正确');
  assert(detailRes.data.undo_status === 'none', '撤销状态正确');
  console.log('  批次详情 - 规则摘要:', JSON.stringify(detailRes.data.rules_summary[0]));

  log('6. 测试批次撤销 - 新增规则停用');
  
  const undoCreateRuleName = TEST_PREFIX + '撤销测试-新增-' + timestamp;
  const undoCreateRule = createTestRule(undoCreateRuleName, BASE_PRIORITY + 2, 550001);
  
  const undoCreateImportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [undoCreateRule] });
  
  assert(undoCreateImportRes.status === 200, '撤销测试-新增规则导入成功');
  const undoCreateBatchId = undoCreateImportRes.data.batch_id;
  assert(undoCreateBatchId !== undefined, '返回批次号');

  reloadDb();
  const undoCreateRuleVersionsBefore = ApprovalRule.findAllVersionsByName(undoCreateRuleName);
  assert(undoCreateRuleVersionsBefore.length === 1, '导入后有1个版本');
  assert(undoCreateRuleVersionsBefore[0].is_active === 1, '版本活跃');
  
  const undoCreateRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/batches/${undoCreateBatchId}/undo`,
    method: 'POST'
  });
  
  assert(undoCreateRes.status === 200, '撤销成功');
  assert(undoCreateRes.data.success === true, '撤销成功标记');
  assert(undoCreateRes.data.batch_id === undoCreateBatchId, '批次号正确');
  assert(undoCreateRes.data.summary.deactivated === 1, '停用1条规则');
  assert(undoCreateRes.data.summary.skipped === 0, '跳过0条');
  
  const undoCreateResult = undoCreateRes.data.undo_results.find(r => r.name === undoCreateRuleName);
  assert(undoCreateResult !== undefined, '撤销结果包含目标规则');
  assert(undoCreateResult.undo_action === 'deactivated', '动作为停用');
  assert(undoCreateResult.version === 1, '停用版本为1');

  reloadDb();
  const undoCreateRuleVersionsAfter = ApprovalRule.findAllVersionsByName(undoCreateRuleName);
  assert(undoCreateRuleVersionsAfter.length === 1, '仍保留1个版本（历史不删除）');
  assert(undoCreateRuleVersionsAfter[0].is_active === 0, '该版本已被停用');
  console.log(`  规则 ${undoCreateRuleName} 版本状态: v${undoCreateRuleVersionsAfter[0].version} active=${undoCreateRuleVersionsAfter[0].is_active}`);

  const undoCreateBatchAfter = ImportBatch.findById(undoCreateBatchId);
  assert(undoCreateBatchAfter.undo_status === 'completed', '批次状态更新为已撤销');
  assert(undoCreateBatchAfter.undo_by === ADMIN_USER_ID, '记录撤销操作者');
  assert(undoCreateBatchAfter.undo_by_name === '系统管理员', '记录撤销者姓名');
  assert(undoCreateBatchAfter.undo_at > 0, '记录撤销时间');
  assert(undoCreateBatchAfter.undo_results.length === 1, '保存撤销结果');

  log('7. 测试混合导入批次（新增+更新+无变化）');
  
  const updateRule = {
    ...newRule,
    description: '更新后的描述',
    priority: BASE_PRIORITY + 3
  };
  const noChangeRule = createTestRule(TEST_PREFIX + '无变化规则-' + timestamp, BASE_PRIORITY + 4, 600001);
  
  await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [noChangeRule] });

  const mixedImportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, { rules: [updateRule, noChangeRule] });

  assert(mixedImportRes.status === 200, '混合导入成功');
  const mixedBatchId = mixedImportRes.data.batch_id;
  assert(mixedBatchId !== undefined, '返回批次号');
  assert(mixedImportRes.data.summary.update === 1, '摘要显示1条更新');
  assert(mixedImportRes.data.summary.no_change === 1, '摘要显示1条无变化');
  assert(mixedImportRes.data.imported === 1, '实际导入1条');
  assert(mixedImportRes.data.skipped === 1, '跳过1条');

  reloadDb();
  const mixedBatch = ImportBatch.findById(mixedBatchId);
  assert(mixedBatch !== null, '混合批次已持久化');
  assert(mixedBatch.summary.update === 1, '批次摘要包含更新计数');
  assert(mixedBatch.summary.no_change === 1, '批次摘要包含无变化计数');
  assert(mixedBatch.rules_summary.length === 2, '包含2条规则级差异');

  const updateRuleSummary = mixedBatch.rules_summary.find(r => r.change_type === 'update');
  assert(updateRuleSummary !== undefined, '存在update类型规则');
  assert(updateRuleSummary.field_diff.description !== undefined, '字段差异包含description');
  assert(updateRuleSummary.field_diff.priority !== undefined, '字段差异包含priority');

  const noChangeSummary = mixedBatch.rules_summary.find(r => r.change_type === 'no_change');
  assert(noChangeSummary !== undefined, '存在no_change类型规则');

  log('8. 测试批次撤销 - 更新规则切回上一版本');
  
  reloadDb();
  const newRuleVersionsBefore = ApprovalRule.findAllVersionsByName(newRuleName);
  console.log(`  撤销前规则版本: 共${newRuleVersionsBefore.length}个，活跃v${newRuleVersionsBefore.find(r => r.is_active)?.version}`);
  
  const undoMixedRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/batches/${mixedBatchId}/undo`,
    method: 'POST'
  });

  assert(undoMixedRes.status === 200, '混合批次撤销成功');
  assert(undoMixedRes.data.summary.reverted === 1, '回滚1条规则');
  assert(undoMixedRes.data.summary.skipped === 1, '跳过1条（无变化）');

  const revertedResult = undoMixedRes.data.undo_results.find(r => r.undo_action === 'reverted');
  assert(revertedResult !== undefined, '存在回滚结果');
  assert(revertedResult.change_type === 'update', '原变更类型为update');
  assert(revertedResult.deactivated_version === 2, '停用v2');
  assert(revertedResult.based_on_version === 1, '基于v1内容');
  assert(revertedResult.reactivated_version > 2, '创建新版本号');

  reloadDb();
  const updatedRuleVersions = ApprovalRule.findAllVersionsByName(newRuleName);
  const maxVersion = Math.max(...updatedRuleVersions.map(r => r.version));
  const activeVersion = updatedRuleVersions.find(r => r.is_active);
  assert(activeVersion !== undefined, '存在活跃版本');
  assert(activeVersion.version === maxVersion, '最新版本为活跃版本');
  assert(activeVersion.description === '批次追踪测试规则', '内容已切回原始描述');
  assert(activeVersion.priority === BASE_PRIORITY + 1, '优先级已切回原始值');
  console.log(`  回滚后活跃版本: v${activeVersion.version}, 描述: ${activeVersion.description}`);

  const skippedResult = undoMixedRes.data.undo_results.find(r => r.undo_action === 'skipped');
  assert(skippedResult !== undefined, '存在跳过结果');
  assert(skippedResult.reason.includes('无变化'), '跳过原因正确');

  log('9. 测试重复撤销被拒绝');
  
  const doubleUndoRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/batches/${undoCreateBatchId}/undo`,
    method: 'POST'
  });
  assert(doubleUndoRes.status === 400, '重复撤销返回400');
  assert(doubleUndoRes.data.error.includes('已被撤销'), '错误信息正确');

  log('10. 测试不存在的批次撤销');
  
  const notFoundUndo = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches/non-existent-batch-id/undo',
    method: 'POST'
  });
  assert(notFoundUndo.status === 404, '不存在的批次返回404');

  log('11. 测试审计日志');
  
  const auditRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs?limit=200',
    method: 'GET'
  });
  
  assert(auditRes.status === 200, '获取审计日志成功');
  const undoLogs = auditRes.data.filter(l => l.action === 'rule_batch_undo');
  assert(undoLogs.length >= 2, '至少有2条撤销审计日志（停用1条+回滚1条）');

  const deactivateLog = undoLogs.find(l => {
    let nv = l.new_value;
    if (typeof nv === 'string') try { nv = JSON.parse(nv); } catch (e) {}
    return nv && nv.undo_action === 'deactivated' && nv.batch_id === undoCreateBatchId;
  });
  assert(deactivateLog !== undefined, '存在停用动作的审计日志');

  const revertLog = undoLogs.find(l => {
    let nv = l.new_value;
    if (typeof nv === 'string') try { nv = JSON.parse(nv); } catch (e) {}
    return nv && nv.undo_action === 'reverted' && nv.batch_id === mixedBatchId;
  });
  assert(revertLog !== undefined, '存在回滚动作的审计日志');
  console.log(`  撤销审计日志共 ${undoLogs.length} 条`);

  const importLogs = auditRes.data.filter(l => l.action === 'rule_import');
  assert(importLogs.length >= 4, '至少有4条导入审计日志');
  console.log(`  导入审计日志共 ${importLogs.length} 条`);

  log('12. 测试撤销后的导出结果');
  
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  assert(exportRes.status === 200, '导出成功');
  const exportedRules = exportRes.data.rules;
  
  const exportedUndoCreateRule = exportedRules.find(r => r.name === undoCreateRuleName);
  assert(exportedUndoCreateRule === undefined, '被撤销的新增规则不在导出结果中');

  const exportedUpdatedRule = exportedRules.find(r => r.name === newRuleName && r.description === '批次追踪测试规则');
  assert(exportedUpdatedRule !== undefined, '回滚后的规则在导出结果中，内容为原始版本');
  console.log(`  导出规则数量: ${exportedRules.length}`);
  console.log(`  回滚后规则版本: v${exportedUpdatedRule.version}`);

  log('13. 测试数据库直接查询验证');
  
  reloadDb();
  const dbBatches = ImportBatch.findAll({ limit: 100 });
  assert(dbBatches.length >= 4, '数据库中至少有4个批次');
  
  const dbUndoCreateBatch = ImportBatch.findById(undoCreateBatchId);
  assert(dbUndoCreateBatch !== null, '可通过ID查询撤销新增批次');
  assert(dbUndoCreateBatch.undo_status === 'completed', '撤销新增状态已持久化');
  assert(dbUndoCreateBatch.undo_results.length === 1, '撤销新增结果已持久化');
  
  const dbMixedBatch = ImportBatch.findById(mixedBatchId);
  assert(dbMixedBatch !== null, '可通过ID查询混合批次');
  assert(dbMixedBatch.undo_status === 'completed', '混合批次撤销状态已持久化');
  console.log('  数据库中批次数量:', dbBatches.length);

  console.log('\n========================================');
  console.log('  ✅ 所有批次追踪测试通过！');
  console.log('========================================\n');
  
  console.log('请重启服务后运行持久性验证测试:');
  console.log(`  node tests/test-batch-persistence.js ${undoCreateBatchId} ${mixedBatchId} ${undoCreateRuleName} ${newRuleName}`);
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
