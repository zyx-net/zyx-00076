const db = require('../src/database/db');

console.log('=== 测试 SQL 解析 ===');

const sql1 = `SELECT * FROM audit_logs WHERE contract_id = ? ORDER BY created_at`;
const sql2 = `SELECT * FROM audit_logs 
WHERE contract_id = ?
ORDER BY created_at`;

console.log('SQL1 (单行):', sql1);
console.log('SQL2 (多行):', JSON.stringify(sql2));

class TestStatement extends db.Statement {
  constructor(database, sql) {
    super(database, sql);
  }
  
  testParse() {
    console.log('\n--- 解析结果 ---');
    console.log('sql:', this.sql);
    console.log('table:', this.parseTable(this.sql));
    console.log('where:', this.parseWhere(this.sql));
    console.log('orderBy:', this.parseOrderBy(this.sql));
    console.log('params:', this.params);
  }
}

const stmt1 = new TestStatement(db, sql1);
stmt1.testParse();

const stmt2 = new TestStatement(db, sql2);
stmt2.testParse();

console.log('\n=== 测试实际查询 ===');
const stmt3 = db.prepare(sql2);
console.log('stmt3.sql:', stmt3.sql);
console.log('stmt3.params before:', stmt3.params);

const allLogs = db.prepare('SELECT * FROM audit_logs').all();
console.log('所有日志数量:', allLogs.length);

if (allLogs.length > 0) {
  const contractId = allLogs[0].contract_id;
  console.log('查询 contract_id:', contractId);
  
  const result = stmt3.all(contractId);
  console.log('stmt3.params after:', stmt3.params);
  console.log('查询结果数量:', result.length);
  result.forEach(function(l) {
    console.log('  contract_id=' + l.contract_id + ', action=' + l.action);
  });
}
