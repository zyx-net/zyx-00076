const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const ApprovalRule = require('../src/models/ApprovalRule');
const AuditLog = require('../src/models/AuditLog');

db.load();

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

async function debug() {
  console.log('=== 调试失败的测试 ===\n');

  // 1. 先导出
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  
  const testRule = exportRes.data.rules[exportRes.data.rules.length - 1];
  console.log('测试规则:', testRule.name, '版本:', testRule.version);
  
  // 2. 预检
  const previewRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, exportRes.raw);
  
  const diff = previewRes.data.differences.find(d => d.name === testRule.name);
  console.log('\n预检差异:', JSON.stringify(diff, null, 2));
  console.log('action:', diff.action);
  console.log('changes:', diff.changes);
  
  // 检查现有规则
  db.load();
  const existing = ApprovalRule.findByName(testRule.name);
  console.log('\n现有规则:');
  console.log('  conditions:', JSON.stringify(existing.conditions));
  console.log('  导入的conditions:', JSON.stringify(testRule.conditions));
  console.log('  相等:', JSON.stringify(existing.conditions) === JSON.stringify(testRule.conditions));
  console.log('  steps:', JSON.stringify(existing.steps));
  console.log('  导入的steps:', JSON.stringify(testRule.steps));
  console.log('  相等:', JSON.stringify(existing.steps) === JSON.stringify(testRule.steps));
  console.log('  priority:', existing.priority, '导入的:', testRule.priority);
  console.log('  相等:', existing.priority === testRule.priority);
  console.log('  description:', existing.description, '导入的:', testRule.description);
  console.log('  相等:', existing.description === testRule.description);
  
  // 3. 正式导入
  const importRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import',
    method: 'POST'
  }, exportRes.raw);
  
  console.log('\n导入结果:', JSON.stringify(importRes.data, null, 2));
  
  // 检查审计日志
  db.load();
  const logs = AuditLog.findAll(100);
  const importLogs = logs.filter(l => l.action === 'rule_import');
  const latestLog = importLogs[importLogs.length - 1];
  console.log('\n最新审计日志:');
  console.log('  new_value type:', typeof latestLog.new_value);
  console.log('  new_value raw:', latestLog.new_value);
  
  if (typeof latestLog.new_value === 'string') {
    try {
      const parsed = JSON.parse(latestLog.new_value);
      console.log('  new_value parsed:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('  parse error:', e.message);
    }
  }
}

debug().catch(err => console.error(err));
