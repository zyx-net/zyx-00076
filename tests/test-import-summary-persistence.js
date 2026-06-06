const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const ApprovalRule = require('../src/models/ApprovalRule');
const AuditLog = require('../src/models/AuditLog');

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
  const ruleName = process.argv[2];
  const batchId = process.argv[3];

  if (!ruleName || !batchId) {
    console.error('用法: node tests/test-import-summary-persistence.js <ruleName> <batchId>');
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  变更摘要 - 服务重启持久性测试');
  console.log('========================================\n');
  console.log('规则名称:', ruleName);
  console.log('批次号:', batchId);
  console.log();

  db.load();

  console.log('=== 数据库直接查询 ===\n');

  const ruleVersions = ApprovalRule.findAllVersionsByName(ruleName);
  assert(ruleVersions.length >= 2, '规则版本历史完整（至少2个版本）');
  console.log(`  找到 ${ruleVersions.length} 个版本:`);
  ruleVersions.forEach(v => {
    console.log(`    - v${v.version} (active: ${v.is_active}, priority: ${v.priority})`);
  });

  const activeRule = ruleVersions.find(r => r.is_active === 1);
  assert(activeRule !== undefined, '存在活跃版本');
  assert(activeRule.version === 2, '最新活跃版本是 v2');
  assert(activeRule.description === '更新后的描述', '更新后的描述已持久化');

  const auditLogs = AuditLog.findAll(200);
  const importLogs = auditLogs.filter(l => l.action === 'rule_import');
  assert(importLogs.length >= 2, '导入审计日志已持久化');
  
  let logsWithBatchId = 0;
  let logsWithChangeType = 0;
  let logsWithFieldDiff = 0;
  
  for (const log of importLogs) {
    let newValue = log.new_value;
    if (typeof newValue === 'string') {
      try { newValue = JSON.parse(newValue); } catch (e) {}
    }
    if (newValue && newValue.batch_id === batchId) logsWithBatchId++;
    if (newValue && newValue.change_type) logsWithChangeType++;
    if (newValue && newValue.field_diff) logsWithFieldDiff++;
  }
  
  assert(logsWithBatchId >= 1, '审计日志包含批次号');
  assert(logsWithChangeType >= 2, '审计日志包含变更类型');
  assert(logsWithFieldDiff >= 2, '审计日志包含字段差异');
  console.log(`  导入审计日志: ${importLogs.length} 条`);
  console.log(`  含批次号: ${logsWithBatchId} 条`);
  console.log(`  含变更类型: ${logsWithChangeType} 条`);
  console.log(`  含字段差异: ${logsWithFieldDiff} 条`);

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

  const versionsRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rules/${ruleName}/versions`,
    method: 'GET'
  });
  
  assert(versionsRes.status === 200, '版本列表API正常');
  assert(versionsRes.data.length >= 2, 'API返回至少2个版本');
  assert(versionsRes.data[0].version === 2, 'API返回的最新版本是 v2');

  const auditRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/audit-logs?limit=200',
    method: 'GET'
  });
  
  const apiImportLogs = auditRes.data.filter(l => l.action === 'rule_import');
  assert(apiImportLogs.length >= 2, 'API返回的导入审计日志完整');

  let apiLogsWithBatchId = 0;
  for (const log of apiImportLogs) {
    let newValue = log.new_value;
    if (typeof newValue === 'string') {
      try { newValue = JSON.parse(newValue); } catch (e) {}
    }
    if (newValue && newValue.batch_id === batchId) apiLogsWithBatchId++;
  }
  assert(apiLogsWithBatchId >= 1, 'API返回的审计日志包含批次号');

  console.log('\n========================================');
  console.log('  ✅ 服务重启持久性测试通过！');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
