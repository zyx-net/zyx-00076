const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const ApprovalRule = require('../src/models/ApprovalRule');
const AuditLog = require('../src/models/AuditLog');

function reloadDb() {
  db.load();
}

const ADMIN_USER_ID = User.findByUsername('admin').id;

let passed = 0;
let failed = 0;
const failures = [];

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

const ruleName = process.argv[2];

if (!ruleName) {
  console.error('请提供规则名称作为参数: node tests/test-export-import-restart.js <ruleName>');
  process.exit(1);
}

async function runTests() {
  console.log('\n========================================');
  console.log('  导出再导入 - 重启后验证测试');
  console.log('========================================\n');
  
  console.log(`测试规则: ${ruleName}\n`);

  reloadDb();

  // 测试 1: 验证规则存在且可读
  console.log('=== 1. 验证规则存在且可读 ===\n');
  
  const rule = ApprovalRule.findByName(ruleName);
  assert(rule !== null, '规则存在');
  assert(rule.version === 3, '规则版本为v3');
  assert(rule.is_active === 1, '规则为激活状态');
  assert(rule.name === ruleName, '规则名称正确');
  
  // 测试 2: 验证版本历史完整
  console.log('\n=== 2. 验证版本历史完整 ===\n');
  
  const allVersions = ApprovalRule.findAllVersionsByName(ruleName);
  assert(allVersions.length >= 3, '至少有3个版本');
  assert(allVersions[0].version === 3, '最新版本为v3');
  assert(allVersions[allVersions.length - 1].version === 1, '最早版本为v1');
  
  // 测试 3: 验证导出功能正常
  console.log('\n=== 3. 验证导出功能正常 ===\n');
  
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  assert(exportRes.status === 200, '导出接口返回200');
  assert(Array.isArray(exportRes.data.rules), '导出包含rules数组');
  
  const exportedRule = exportRes.data.rules.find(r => r.name === ruleName);
  assert(exportedRule !== null, '导出包含测试规则');
  assert(exportedRule.version === 3, '导出版本为v3');
  
  // 测试 4: 验证导出结果可直接导入预检
  console.log('\n=== 4. 验证导出结果可直接导入预检 ===\n');
  
  const previewRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, exportRes.raw);
  
  assert(previewRes.status === 200, '导出结果可直接导入预检');
  assert(previewRes.data.can_import === true, '预检通过');
  
  const diff = previewRes.data.differences.find(d => d.name === ruleName);
  assert(diff !== null, '预检包含测试规则');
  assert(diff.current_version === 3, '当前版本为v3');
  assert(diff.new_version === 4, '新版本为v4');
  
  // 测试 5: 验证审计日志完整
  console.log('\n=== 5. 验证审计日志完整 ===\n');
  
  const logs = AuditLog.findAll(100);
  const importLogs = logs.filter(l => l.action === 'rule_import');
  assert(importLogs.length >= 3, '至少有3条导入审计日志');
  
  const ruleImportLogs = importLogs.filter(l => {
    if (!l.new_value) return false;
    const newValue = typeof l.new_value === 'string' ? JSON.parse(l.new_value) : l.new_value;
    return newValue.name === ruleName;
  });
  assert(ruleImportLogs.length >= 3, '测试规则至少有3条导入审计日志');
  
  // 测试 6: 验证正式导入正常
  console.log('\n=== 6. 验证正式导入正常 ===\n');
  
  const importRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, exportRes.raw);
  
  assert(importRes.status === 200, '正式导入成功');
  
  const result = importRes.data.results.find(r => r.name === ruleName);
  assert(result !== null, '导入结果包含测试规则');
  assert(result.version === 4, '导入后版本为v4');
  
  reloadDb();
  const ruleAfterImport = ApprovalRule.findByName(ruleName);
  assert(ruleAfterImport.version === 4, '数据库中版本为v4');
  
  // 测试总结
  console.log('\n========================================');
  console.log('  重启后验证完成');
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
    console.log('\n  ✅ 所有重启后验证通过！');
    console.log(`  ✅ 规则 ${ruleName} 版本已从v3升级到v4`);
  }
}

runTests().catch(err => {
  console.error('测试执行出错:', err);
  process.exit(1);
});
