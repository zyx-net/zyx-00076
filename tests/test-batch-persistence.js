const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const ApprovalRule = require('../src/models/ApprovalRule');
const AuditLog = require('../src/models/AuditLog');
const ImportBatch = require('../src/models/ImportBatch');

const ADMIN_USER_ID = User.findByUsername('admin').id;

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

function assert(condition, message) {
  if (!condition) {
    console.error('\n❌ 断言失败:', message);
    process.exit(1);
  }
  console.log('✅', message);
}

async function runTests() {
  const undoCreateBatchId = process.argv[2];
  const mixedBatchId = process.argv[3];
  const undoCreateRuleName = process.argv[4];
  const newRuleName = process.argv[5];

  if (!undoCreateBatchId || !mixedBatchId || !undoCreateRuleName || !newRuleName) {
    console.error('用法: node tests/test-batch-persistence.js <undoCreateBatchId> <mixedBatchId> <undoCreateRuleName> <newRuleName>');
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  导入批次 - 服务重启持久性测试');
  console.log('========================================\n');
  console.log('撤销新增批次:', undoCreateBatchId);
  console.log('混合批次:', mixedBatchId);
  console.log('撤销新增规则:', undoCreateRuleName);
  console.log('更新回滚规则:', newRuleName);
  console.log();

  db.load();

  console.log('=== 数据库直接查询验证 ===\n');

  const undoCreateBatch = ImportBatch.findById(undoCreateBatchId);
  assert(undoCreateBatch !== null, '撤销新增批次在重启后仍存在');
  assert(undoCreateBatch.id === undoCreateBatchId, '撤销新增批次ID正确');
  assert(undoCreateBatch.undo_status === 'completed', '撤销新增批次撤销状态持久化');
  assert(undoCreateBatch.undo_by === ADMIN_USER_ID, '撤销新增批次撤销者持久化');
  assert(undoCreateBatch.undo_at > 0, '撤销新增批次撤销时间持久化');
  assert(undoCreateBatch.undo_results !== null, '撤销新增批次撤销结果持久化');
  assert(Array.isArray(undoCreateBatch.undo_results), '撤销结果为数组');
  assert(undoCreateBatch.undo_results.length === 1, '撤销新增批次有1条撤销结果');
  assert(undoCreateBatch.undo_results[0].undo_action === 'deactivated', '撤销动作是停用');
  console.log(`  撤销新增批次撤销状态: ${undoCreateBatch.undo_status}`);
  console.log(`  撤销新增批次撤销者: ${undoCreateBatch.undo_by_name}`);
  console.log(`  撤销新增批次撤销结果数: ${undoCreateBatch.undo_results.length}`);

  const mixedBatch = ImportBatch.findById(mixedBatchId);
  assert(mixedBatch !== null, '混合批次在重启后仍存在');
  assert(mixedBatch.id === mixedBatchId, '混合批次ID正确');
  assert(mixedBatch.undo_status === 'completed', '混合批次撤销状态持久化');
  assert(mixedBatch.summary.update === 1, '混合批次摘要持久化（更新1条）');
  assert(mixedBatch.summary.no_change === 1, '混合批次摘要持久化（无变化1条）');
  assert(mixedBatch.rules_summary.length === 2, '混合批次规则摘要持久化');
  console.log(`  混合批次撤销状态: ${mixedBatch.undo_status}`);
  console.log(`  混合批次规则摘要数: ${mixedBatch.rules_summary.length}`);

  const allBatches = ImportBatch.findAll({ limit: 100 });
  assert(allBatches.length >= 4, '重启后至少有4个批次');
  console.log(`  总批次数量: ${allBatches.length}`);

  const undoCreateRuleVersions = ApprovalRule.findAllVersionsByName(undoCreateRuleName);
  assert(undoCreateRuleVersions.length >= 1, '撤销新增规则版本历史完整（至少1个版本）');
  console.log(`  规则 ${undoCreateRuleName} 版本数量: ${undoCreateRuleVersions.length}`);
  undoCreateRuleVersions.forEach(v => {
    console.log(`    - v${v.version} (active: ${v.is_active}, priority: ${v.priority})`);
  });
  const undoCreateActiveRule = undoCreateRuleVersions.find(r => r.is_active === 1);
  assert(undoCreateActiveRule === undefined, '撤销新增规则没有活跃版本（已被停用）');

  const newRuleVersions = ApprovalRule.findAllVersionsByName(newRuleName);
  assert(newRuleVersions.length >= 3, '更新回滚规则版本历史完整（至少3个版本）');
  console.log(`  规则 ${newRuleName} 版本数量: ${newRuleVersions.length}`);
  newRuleVersions.forEach(v => {
    console.log(`    - v${v.version} (active: ${v.is_active}, priority: ${v.priority}, desc: ${v.description?.substring(0, 20)})`);
  });
  const newRuleActive = newRuleVersions.find(r => r.is_active === 1);
  assert(newRuleActive !== undefined, '存在活跃版本');
  assert(newRuleActive.description === '批次追踪测试规则', '活跃版本内容为撤销回退的版本');
  console.log(`  活跃版本: v${newRuleActive.version}`);

  const auditLogs = AuditLog.findAll(200);
  const undoLogs = auditLogs.filter(l => l.action === 'rule_batch_undo');
  assert(undoLogs.length >= 2, '撤销审计日志已持久化');
  
  let logsWithBatchId = 0;
  let logsWithUndoAction = 0;
  
  for (const log of undoLogs) {
    let newValue = log.new_value;
    if (typeof newValue === 'string') {
      try { newValue = JSON.parse(newValue); } catch (e) {}
    }
    if (newValue && (newValue.batch_id === undoCreateBatchId || newValue.batch_id === mixedBatchId)) logsWithBatchId++;
    if (newValue && newValue.undo_action) logsWithUndoAction++;
  }
  
  assert(logsWithBatchId >= 2, '审计日志包含批次号');
  assert(logsWithUndoAction >= 2, '审计日志包含撤销动作');
  console.log(`  撤销审计日志: ${undoLogs.length} 条`);
  console.log(`  含批次号: ${logsWithBatchId} 条`);
  console.log(`  含撤销动作: ${logsWithUndoAction} 条`);

  console.log('\n=== API 查询验证 ===\n');

  const persistRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/persistence-check',
    method: 'GET'
  });
  
  assert(persistRes.status === 200, '持久性检查API正常');
  assert(persistRes.data.status === 'ok', '所有持久性检查通过');
  assert(persistRes.data.checks.db_file_exists === true, '数据库文件存在');
  assert(persistRes.data.checks.save_consistent === true, '内存与文件数据一致');

  const batchListRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches?limit=100',
    method: 'GET'
  });
  
  assert(batchListRes.status === 200, '批次列表API正常');
  assert(batchListRes.data.length >= 4, 'API返回至少4个批次');
  
  const apiUndoCreateBatch = batchListRes.data.find(b => b.id === undoCreateBatchId);
  assert(apiUndoCreateBatch !== undefined, 'API返回撤销新增批次');
  assert(apiUndoCreateBatch.undo_status === 'completed', 'API返回撤销新增批次撤销状态');
  assert(apiUndoCreateBatch.user_name === '系统管理员', 'API返回撤销新增批次操作者姓名');
  
  const apiMixedBatch = batchListRes.data.find(b => b.id === mixedBatchId);
  assert(apiMixedBatch !== undefined, 'API返回混合批次');
  assert(apiMixedBatch.undo_status === 'completed', 'API返回混合批次撤销状态');

  const batchDetailRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/batches/${undoCreateBatchId}`,
    method: 'GET'
  });
  
  assert(batchDetailRes.status === 200, '批次详情API正常');
  assert(batchDetailRes.data.id === undoCreateBatchId, '详情ID正确');
  assert(batchDetailRes.data.undo_status === 'completed', '详情撤销状态正确');
  assert(batchDetailRes.data.undo_results.length === 1, '详情包含撤销结果');
  assert(batchDetailRes.data.undo_results[0].undo_action === 'deactivated', '撤销动作是停用');
  assert(batchDetailRes.data.rules_summary.length === 1, '详情包含规则摘要');
  assert(batchDetailRes.data.config_switches !== undefined, '详情包含配置开关');
  assert(batchDetailRes.data.created_at > 0, '详情包含创建时间');

  const versionsRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${newRuleName}/versions`,
    method: 'GET'
  });
  
  assert(versionsRes.status === 200, '版本列表API正常');
  assert(versionsRes.data.length >= 3, 'API返回至少3个版本');
  
  const activeFromApi = versionsRes.data.find(r => r.is_active === 1);
  assert(activeFromApi !== undefined, 'API返回存在活跃版本');
  assert(activeFromApi.description === '批次追踪测试规则', '活跃版本内容正确');
  console.log(`  API返回活跃版本: v${activeFromApi.version}`);

  const auditRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs?limit=200',
    method: 'GET'
  });
  
  const apiUndoLogs = auditRes.data.filter(l => l.action === 'rule_batch_undo');
  assert(apiUndoLogs.length >= 2, 'API返回的撤销审计日志完整');

  let apiLogsWithBatchId = 0;
  for (const log of apiUndoLogs) {
    let newValue = log.new_value;
    if (typeof newValue === 'string') {
      try { newValue = JSON.parse(newValue); } catch (e) {}
    }
    if (newValue && (newValue.batch_id === undoCreateBatchId || newValue.batch_id === mixedBatchId)) apiLogsWithBatchId++;
  }
  assert(apiLogsWithBatchId >= 2, 'API返回的审计日志包含批次号');

  console.log('\n=== 撤销后导出结果验证 ===\n');

  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  assert(exportRes.status === 200, '导出API正常');
  const exportedRules = exportRes.data.rules;
  
  const exportedUndoCreateRule = exportedRules.find(r => r.name === undoCreateRuleName);
  assert(exportedUndoCreateRule === undefined, '被撤销的新增规则不在导出结果中');
  
  const exportedNewRule = exportedRules.find(r => r.name === newRuleName);
  assert(exportedNewRule !== undefined, '目标规则在导出结果中');
  assert(exportedNewRule.description === '批次追踪测试规则', '导出的规则内容为撤销后的版本');
  assert(exportedNewRule.is_active === 1, '导出的规则为活跃状态');
  console.log(`  导出的规则版本: v${exportedNewRule.version}`);
  console.log(`  导出的规则描述: ${exportedNewRule.description}`);

  console.log('\n=== 按撤销状态筛选验证 ===\n');

  const completedBatches = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches?undo_status=completed&limit=10',
    method: 'GET'
  });
  
  assert(completedBatches.status === 200, '按状态筛选API正常');
  assert(completedBatches.data.every(b => b.undo_status === 'completed'), '所有返回批次状态为completed');
  assert(completedBatches.data.length >= 2, '至少有2个已撤销批次');
  console.log(`  已撤销批次数量: ${completedBatches.data.length}`);

  const noneBatches = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/batches?undo_status=none&limit=10',
    method: 'GET'
  });
  
  assert(noneBatches.status === 200, '按未撤销状态筛选API正常');
  assert(noneBatches.data.every(b => b.undo_status === 'none'), '所有返回批次状态为none');
  console.log(`  未撤销批次数量: ${noneBatches.data.length}`);

  console.log('\n========================================');
  console.log('  ✅ 服务重启持久性测试通过！');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
