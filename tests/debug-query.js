const db = require('../src/database/db');
const AuditLog = require('../src/models/AuditLog');

console.log('=== 调试 AuditLog.findByContract ===');

const allLogs = db.prepare('SELECT * FROM audit_logs').all();
console.log('所有审计日志数量:', allLogs.length);
console.log('所有审计日志:', JSON.stringify(allLogs.map(l => ({ id: l.id, contract_id: l.contract_id, action: l.action })), null, 2));

const contractAId = allLogs[0]?.contract_id;
if (contractAId) {
  console.log('\n用 contract_id =', contractAId, '查询:');
  const logs = db.prepare('SELECT * FROM audit_logs WHERE contract_id = ?').all(contractAId);
  console.log('查询结果数量:', logs.length);
  console.log('查询结果:', JSON.stringify(logs.map(l => ({ contract_id: l.contract_id, action: l.action })), null, 2));
}
