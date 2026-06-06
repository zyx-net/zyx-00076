const http = require('http');
const User = require('../src/models/User');
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

async function runRepro() {
  console.log('=== 问题复现：导出再导入 ===\n');

  // Step 1: 导出规则
  console.log('1. 调用导出接口...');
  const exportRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  });
  console.log('   导出状态:', exportRes.status);
  console.log('   导出数据顶层字段:', Object.keys(exportRes.data));
  console.log('   规则数量:', exportRes.data.rules?.length);
  
  if (exportRes.data.rules && exportRes.data.rules.length > 0) {
    const rule = exportRes.data.rules[0];
    console.log('   第一条规则包含字段:', Object.keys(rule));
    console.log('   第一条规则 version:', rule.version);
    console.log('   第一条规则 is_active:', rule.is_active);
    console.log('   第一条规则 created_at:', rule.created_at);
    console.log('   第一条规则 created_by:', rule.created_by);
  }

  // Step 2: 直接将完整导出结果提交到导入预检
  console.log('\n2. 将完整导出结果（含 exported_at 等）提交到导入预检...');
  const previewRes1 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, JSON.stringify(exportRes.data));
  console.log('   预检状态:', previewRes1.status);
  console.log('   预检响应:', JSON.stringify(previewRes1.data, null, 2));

  // Step 3: 只提取 rules 数组提交
  console.log('\n3. 只提取 rules 数组提交到导入预检...');
  const previewRes2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/import?preview=true',
    method: 'POST'
  }, JSON.stringify({ rules: exportRes.data.rules }));
  console.log('   预检状态:', previewRes2.status);
  if (previewRes2.status === 400) {
    console.log('   预检响应:', JSON.stringify(previewRes2.data, null, 2));
  } else {
    console.log('   预检成功，差异数:', previewRes2.data.differences?.length);
  }

  // Step 4: 检查导入schema接受的字段
  console.log('\n4. 检查导入Joi schema接受的字段:');
  console.log('   - name (required)');
  console.log('   - description');
  console.log('   - priority (required)');
  console.log('   - conditions (required)');
  console.log('   - steps (required)');
  console.log('   - effective_from');
  console.log('   - effective_to');
  console.log('   不接受的字段: version, is_active, created_at, created_by');
}

runRepro().catch(err => console.error(err));
