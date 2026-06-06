const http = require('http');
const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');

const ADMIN_USER_ID = User.findByUsername('admin').id;

function makeRequest(options, body = null, userId = ADMIN_USER_ID) {
  const headers = options.headers || {};
  headers['x-user-id'] = userId;
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  options.headers = headers;
  
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

async function runHttpTest() {
  console.log('\n========================================');
  console.log('  HTTP 链路测试 - 串单和归档状态验证');
  console.log('========================================\n');

  // 1. 健康检查
  log('1. 健康检查');
  const health = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/health',
    method: 'GET'
  });
  assert(health.status === 200, '服务健康检查通过');

  // 2. 读取用户和部门数据
  log('2. 读取基础数据');
  const users = {};
  User.findAll().forEach(u => { users[u.username] = u; });
  const depts = {};
  Department.findAll().forEach(d => { depts[d.code] = d; });
  console.log('  用户数:', Object.keys(users).length);
  console.log('  部门数:', Object.keys(depts).length);

  // 3. 创建合同A（技术部，5万，低风险）
  log('3. 创建合同A');
  const contractARes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: 'HT-HTTP-A-' + Date.now(),
    title: 'HTTP测试合同A',
    amount: 50000,
    department_id: depts.TECH.id,
    risk_level: 'low',
    content: '这是HTTP测试合同A',
    attachments: [{
      file_name: '合同A附件.pdf',
      file_path: '/files/http-attach-a.pdf',
      is_required: true
    }]
  }, users.zhangsan.id);
  assert(contractARes.status === 201, '合同A创建成功');
  const contractA = contractARes.data;
  console.log('  合同A ID:', contractA.id);

  // 4. 创建合同B（销售部，50万，中风险）
  log('4. 创建合同B');
  const contractBRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/contracts',
    method: 'POST'
  }, {
    contract_no: 'HT-HTTP-B-' + Date.now(),
    title: 'HTTP测试合同B',
    amount: 500000,
    department_id: depts.SALES.id,
    risk_level: 'medium',
    content: '这是HTTP测试合同B',
    attachments: [{
      file_name: '合同B附件.pdf',
      file_path: '/files/http-attach-b.pdf',
      is_required: true
    }]
  }, users.lisi.id);
  assert(contractBRes.status === 201, '合同B创建成功');
  const contractB = contractBRes.data;
  console.log('  合同B ID:', contractB.id);

  // 5. 提交合同A审批
  log('5. 提交合同A审批');
  const submitARes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}/submit`,
    method: 'POST'
  }, {}, users.zhangsan.id);
  assert(submitARes.status === 200, '合同A提交审批成功');
  const step1A = submitARes.data.current_step;
  console.log('  当前步骤:', step1A.step_name);

  // 6. 提交合同B审批
  log('6. 提交合同B审批');
  const submitBRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractB.id}/submit`,
    method: 'POST'
  }, {}, users.lisi.id);
  assert(submitBRes.status === 200, '合同B提交审批成功');
  const step1B = submitBRes.data.current_step;
  console.log('  当前步骤:', step1B.step_name);

  // 7. 交叉审批：先批合同B，再批合同A
  log('7. 审批合同B - 部门经理审批');
  const approveBRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractB.id}/approve`,
    method: 'POST'
  }, {
    step_id: step1B.id,
    action: 'approve',
    comment: '合同B同意'
  }, users.zhangsan.id);
  assert(approveBRes.status === 200, '合同B部门经理审批成功');

  log('8. 审批合同A - 部门经理审批');
  const approveARes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}/approve`,
    method: 'POST'
  }, {
    step_id: step1A.id,
    action: 'approve',
    comment: '合同A同意'
  }, users.qianshiyi.id);
  assert(approveARes.status === 200, '合同A部门经理审批成功');

  // 9. 验证审计日志不串单
  log('9. 验证审计日志不串单');
  const logsA = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}/audit-logs`,
    method: 'GET'
  }, null, users.admin.id)).data;
  
  const logsB = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractB.id}/audit-logs`,
    method: 'GET'
  }, null, users.admin.id)).data;
  
  console.log('  合同A审计日志数:', logsA.length);
  console.log('  合同B审计日志数:', logsB.length);
  
  const idsA = [...new Set(logsA.map(l => l.contract_id))];
  const idsB = [...new Set(logsB.map(l => l.contract_id))];
  
  console.log('  合同A日志contract_id:', idsA);
  console.log('  合同B日志contract_id:', idsB);
  
  assert(idsA.length === 1 && idsA[0] === contractA.id, '合同A审计日志不串单');
  assert(idsB.length === 1 && idsB[0] === contractB.id, '合同B审计日志不串单');

  // 10. 验证时间线不串单
  log('10. 验证时间线不串单');
  const timelineA = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}/timeline`,
    method: 'GET'
  }, null, users.admin.id)).data;
  
  const timelineB = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractB.id}/timeline`,
    method: 'GET'
  }, null, users.admin.id)).data;
  
  console.log('  合同A时间线事件数:', timelineA.length);
  console.log('  合同B时间线事件数:', timelineB.length);
  assert(timelineA.length > 0, '合同A时间线有数据');
  assert(timelineB.length > 0, '合同B时间线有数据');

  // 11. 继续审批合同A直到完成
  log('11. 继续审批合同A直到完成');
  let currentA = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}`,
    method: 'GET'
  }, null, users.admin.id)).data;
  
  while (currentA.status !== 'approved') {
    const stepRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/contracts/${contractA.id}/current-step`,
      method: 'GET'
    }, null, users.admin.id);
    const step = stepRes.data.step;
    if (!step) break;
    
    let approverId = null;
    if (step.required_roles.includes('finance')) approverId = users.wangwu.id;
    if (step.required_roles.includes('legal')) approverId = users.zhaoliu.id;
    if (step.required_roles.includes('risk')) approverId = users.sunqi.id;
    if (step.required_roles.includes('ceo')) approverId = users.zhouba.id;
    
    if (approverId) {
      const approveRes = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: `/api/contracts/${contractA.id}/approve`,
        method: 'POST'
      }, {
        step_id: step.id,
        action: 'approve',
        comment: '同意'
      }, approverId);
      assert(approveRes.status === 200, `步骤 ${step.step_name} 审批成功`);
    }
    
    currentA = (await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/contracts/${contractA.id}`,
      method: 'GET'
    }, null, users.admin.id)).data;
  }
  
  assert(currentA.status === 'approved', '合同A审批完成，状态为approved');
  console.log('  合同A状态:', currentA.status);

  // 12. 归档合同A
  log('12. 归档合同A');
  console.log('  归档前状态:', currentA.status);
  
  const archiveRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}/archive`,
    method: 'POST'
  }, {}, users.admin.id);
  assert(archiveRes.status === 200, '合同A归档成功');
  const archive = archiveRes.data.archive;
  console.log('  归档编号:', archive.archive_no);

  // 13. 验证归档文件中的合同状态
  log('13. 验证归档状态和内容一致性');
  
  const contractAfter = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractA.id}`,
    method: 'GET'
  }, null, users.admin.id)).data;
  console.log('  数据库合同状态:', contractAfter.status);
  
  const archiveContent = (await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/archives/${archive.archive_no}/content`,
    method: 'GET'
  }, null, users.admin.id)).data;
  
  console.log('  归档文件合同状态:', archiveContent.content.contract.status);
  console.log('  归档文件完整性:', archiveContent.is_valid);
  
  assert(archiveContent.content.contract.status === 'archived', '归档文件中合同状态是archived');
  assert(archiveContent.is_valid === true, '归档文件完整性验证通过');
  assert(archiveContent.content.contract.id === contractA.id, '归档内容属于合同A');
  
  // 验证归档内容不串单
  const archiveLogIds = [...new Set(archiveContent.content.audit_logs.map(l => l.contract_id))];
  assert(archiveLogIds.length === 1 && archiveLogIds[0] === contractA.id, '归档内容审计日志不串单');

  console.log('\n========================================');
  console.log('  ✅ HTTP 链路测试第一部分全部通过！');
  console.log('========================================\n');
  console.log('请重启服务后运行第二部分测试:');
  console.log(`  node tests/test-http-part2.js ${contractA.id} ${contractB.id} ${archive.archive_no}`);
}

runHttpTest().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
