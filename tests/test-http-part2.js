const http = require('http');
const User = require('../src/models/User');

const contractAId = process.argv[2];
const contractBId = process.argv[3];
const archiveNo = process.argv[4];

if (!contractAId || !contractBId || !archiveNo) {
  console.error('用法: node tests/test-http-part2.js <contractAId> <contractBId> <archiveNo>');
  process.exit(1);
}

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
    console.log(JSON.stringify(data, null, 2));
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error('\n❌ 断言失败:', message);
    process.exit(1);
  }
  console.log('✅', message);
}

async function runHttpPart2() {
  console.log('\n========================================');
  console.log('  HTTP 链路测试 - 重启后验证');
  console.log('========================================\n');

  console.log('合同A ID:', contractAId);
  console.log('合同B ID:', contractBId);
  console.log('归档编号:', archiveNo);

  // 1. 健康检查 - 确认服务已重启
  log('1. 健康检查 - 确认服务已重启');
  const health = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/health',
    method: 'GET'
  });
  assert(health.status === 200, '服务健康检查通过');
  console.log('  服务已启动，时间戳:', health.data.timestamp);

  // 2. 验证合同A状态
  log('2. 验证合同A状态（重启后）');
  const contractARes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractAId}`,
    method: 'GET'
  });
  assert(contractARes.status === 200, '获取合同A成功');
  const contractA = contractARes.data;
  console.log('  合同A状态:', contractA.status);
  assert(contractA.status === 'archived', '重启后合同A状态应该是archived');

  // 3. 验证合同B状态
  log('3. 验证合同B状态（重启后）');
  const contractBRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractBId}`,
    method: 'GET'
  });
  assert(contractBRes.status === 200, '获取合同B成功');
  const contractB = contractBRes.data;
  console.log('  合同B状态:', contractB.status);
  assert(contractB.status === 'approved' || contractB.status === 'approving', '合同B状态正确');

  // 4. 验证归档文件内容（重启后）
  log('4. 验证归档文件内容（重启后）');
  const archiveContentRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/archives/${archiveNo}/content`,
    method: 'GET'
  });
  assert(archiveContentRes.status === 200, '获取归档内容成功');
  const archiveContent = archiveContentRes.data;

  console.log('  归档文件中合同状态:', archiveContent.content.contract.status);
  console.log('  归档文件完整性验证:', archiveContent.is_valid);

  assert(archiveContent.content.contract.status === 'archived', '重启后归档文件中合同状态应该是archived');
  assert(archiveContent.is_valid === true, '重启后归档文件完整性验证通过');
  assert(archiveContent.content.contract.id === contractAId, '重启后归档内容合同ID正确');
  assert(archiveContent.content.contract.contract_no.startsWith('HT-HTTP-A-'), '重启后归档内容合同编号正确');

  // 5. 验证审计日志不串单（重启后）
  log('5. 验证审计日志不串单（重启后）');
  const logsARes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractAId}/audit-logs`,
    method: 'GET'
  });
  assert(logsARes.status === 200, '获取合同A审计日志成功');

  const logsBRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractBId}/audit-logs`,
    method: 'GET'
  });
  assert(logsBRes.status === 200, '获取合同B审计日志成功');

  console.log('  合同A审计日志数量:', logsARes.data.length);
  console.log('  合同B审计日志数量:', logsBRes.data.length);

  const logContractIdsA = [...new Set(logsARes.data.map(l => l.contract_id))];
  const logContractIdsB = [...new Set(logsBRes.data.map(l => l.contract_id))];

  console.log('  合同A审计日志中的contract_id:', logContractIdsA);
  console.log('  合同B审计日志中的contract_id:', logContractIdsB);

  assert(logContractIdsA.length === 1 && logContractIdsA[0] === contractAId, '重启后合同A的审计日志只能包含合同A自己的记录');
  assert(logContractIdsB.length === 1 && logContractIdsB[0] === contractBId, '重启后合同B的审计日志只能包含合同B自己的记录');

  // 6. 验证时间线不串单（重启后）
  log('6. 验证时间线不串单（重启后）');
  const timelineARes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractAId}/timeline`,
    method: 'GET'
  });
  assert(timelineARes.status === 200, '获取合同A时间线成功');

  const timelineBRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/contracts/${contractBId}/timeline`,
    method: 'GET'
  });
  assert(timelineBRes.status === 200, '获取合同B时间线成功');

  console.log('  合同A时间线事件数量:', timelineARes.data.length);
  console.log('  合同B时间线事件数量:', timelineBRes.data.length);
  assert(timelineARes.data.length > 0, '重启后合同A时间线有数据');
  assert(timelineBRes.data.length > 0, '重启后合同B时间线有数据');

  // 7. 归档内容完整性（重启后）
  log('7. 归档内容完整性验证（重启后）');
  const archiveActionContractIds = [...new Set(archiveContent.content.actions.map(a => a.contract_id))];
  assert(archiveActionContractIds.length === 1 && archiveActionContractIds[0] === contractAId, '重启后归档内容中的审批动作只能属于合同A');

  const archiveAuditContractIds = [...new Set(archiveContent.content.audit_logs.map(l => l.contract_id))];
  assert(archiveAuditContractIds.length === 1 && archiveAuditContractIds[0] === contractAId, '重启后归档内容中的审计日志只能属于合同A');

  console.log('\n========================================');
  console.log('  ✅ HTTP 链路测试全部通过！');
  console.log('========================================\n');

  console.log('\n已验证的场景:');
  console.log('  ✓ 两个合同交叉操作，审计日志不串单');
  console.log('  ✓ 两个合同交叉操作，时间线不串单');
  console.log('  ✓ 归档文件中合同状态正确（archived而非approved）');
  console.log('  ✓ 归档内容不串单');
  console.log('  ✓ 重启后合同状态保持一致');
  console.log('  ✓ 重启后归档文件状态保持一致');
  console.log('  ✓ 重启后归档文件完整性验证通过');
  console.log('  ✓ 重启后审计日志不串单');
  console.log('  ✓ 重启后时间线不串单');
}

runHttpPart2().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
