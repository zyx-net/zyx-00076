const db = require('../src/database/db');

console.log('=== 测试 SQL 解析 ===');

const sql1 = 'SELECT * FROM audit_logs WHERE contract_id = ? ORDER BY created_at';
const sql2 = `SELECT * FROM audit_logs 
WHERE contract_id = ?
ORDER BY created_at`;

console.log('SQL1 (单行):', sql1);
console.log('SQL2 (多行):', JSON.stringify(sql2));

console.log('\n=== 实际执行查询 ===');

const allLogs = db.prepare('SELECT * FROM audit_logs').all();
console.log('所有日志数量:', allLogs.length);

if (allLogs.length > 0) {
  const contractId = allLogs[0].contract_id;
  console.log('查询 contract_id:', contractId);
  
  console.log('\n--- 使用单行 SQL ---');
  const stmt1 = db.prepare(sql1);
  const result1 = stmt1.all(contractId);
  console.log('结果数量:', result1.length);
  result1.forEach(function(l) {
    console.log('  contract_id=' + l.contract_id + ', action=' + l.action);
  });
  
  console.log('\n--- 使用多行 SQL ---');
  const stmt2 = db.prepare(sql2);
  const result2 = stmt2.all(contractId);
  console.log('结果数量:', result2.length);
  result2.forEach(function(l) {
    console.log('  contract_id=' + l.contract_id + ', action=' + l.action);
  });
  
  console.log('\n--- 使用 AuditLog.findByContract ---');
  const AuditLog = require('../src/models/AuditLog');
  const result3 = AuditLog.findByContract(contractId);
  console.log('结果数量:', result3.length);
  result3.forEach(function(l) {
    console.log('  contract_id=' + l.contract_id + ', action=' + l.action);
  });
  
  console.log('\n--- 检查 AuditLog.findByContract 源码 ---');
  console.log(AuditLog.findByContract.toString());
}
