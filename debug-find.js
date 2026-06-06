const db = require('./src/database/db');
const ApprovalDeadline = require('./src/models/ApprovalDeadline');

console.log('=== Testing findForFirstReminder ===');

// Clean up
db.prepare('DELETE FROM approval_deadlines').run();

const now = Date.now();
const firstReminderTime = now + 1000;

// Insert a test record directly
db.prepare(`
  INSERT INTO approval_deadlines 
  (id, contract_id, step_id, step_name, sla_config_id, approver_roles, 
   started_at, deadline_at, first_reminder_at, second_reminder_at, escalation_at,
   first_reminder_sent, second_reminder_sent, escalation_sent, status,
   created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'test-id-123',
  'contract-123',
  'step-123',
  'Test Step',
  'sla-123',
  '["admin"]',
  now,
  now + 86400000,
  firstReminderTime,
  null,
  null,
  0,
  0,
  0,
  'active',
  now,
  now
);

db.forceSave();

// Check the record
const all = db.prepare('SELECT * FROM approval_deadlines').all();
console.log('All records:', JSON.stringify(all, null, 2));

// Try findForFirstReminder
const processTime = firstReminderTime + 100;
console.log('\nProcess time:', processTime);
console.log('first_reminder_at:', firstReminderTime);
console.log('first_reminder_at < processTime:', firstReminderTime < processTime);

const result = ApprovalDeadline.findForFirstReminder(processTime);
console.log('\nfindForFirstReminder result count:', result.length);
console.log('Results:', JSON.stringify(result, null, 2));

// Try direct SQL
const directSql = db.prepare(`
  SELECT * FROM approval_deadlines 
  WHERE status = 'active' 
    AND first_reminder_sent = 0 
    AND first_reminder_at IS NOT NULL 
    AND first_reminder_at < ?
  ORDER BY first_reminder_at ASC
`).all(processTime);
console.log('\nDirect SQL result count:', directSql.length);
console.log('Direct SQL results:', JSON.stringify(directSql, null, 2));
