const part = 'contract_id = ?';
const match = part.match(/(\w+)\s*(=|!=|<>|>=|<=|>|<|IS NULL|IS NOT NULL|LIKE|IN)\s*(.+)?/i);

console.log('=== 测试正则表达式 ===');
console.log('part:', part);
console.log('match:', match);
console.log('col:', match[1]);
console.log('op:', match[2]);
console.log('val:', JSON.stringify(match[3]));
console.log('val === "?":', match[3] === '?');

console.log('\n=== 测试查询逻辑 ===');

const db = require('../src/database/db');

const allLogs = db.prepare('SELECT * FROM audit_logs').all();
console.log('\n所有审计日志数量:', allLogs.length);
console.log('所有审计日志:');
allLogs.forEach(function(l) {
  console.log('  id=' + l.id + ', contract_id=' + l.contract_id + ', action=' + l.action);
});

if (allLogs.length > 0) {
  const contractId = allLogs[0].contract_id;
  console.log('\n用 contract_id =', contractId, '直接查询:');
  
  const query = db.prepare('SELECT * FROM audit_logs WHERE contract_id = ?');
  console.log('SQL:', query.sql);
  console.log('params:', [contractId]);
  
  const result = query.all(contractId);
  console.log('\n查询结果数量:', result.length);
  console.log('查询结果:');
  result.forEach(function(l) {
    console.log('  contract_id=' + l.contract_id + ', action=' + l.action);
  });
  
  console.log('\n预期结果数量应该是 2 (只包含合同A的记录)');
}
