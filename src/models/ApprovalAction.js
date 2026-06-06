const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class ApprovalAction {
  static create({ contract_id, step_id, approver_id, action, comment, attachments }) {
    const id = uuidv4();
    const now = Date.now();
    const attachmentsArr = attachments ? (Array.isArray(attachments) ? attachments : JSON.parse(attachments)) : null;
    const attachmentsStr = attachmentsArr ? JSON.stringify(attachmentsArr) : null;
    
    const stmt = db.prepare(`
      INSERT INTO approval_actions (id, contract_id, step_id, approver_id, action, comment, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, contract_id, step_id, approver_id, action, comment || null, attachmentsStr, now);
    return {
      id, contract_id, step_id, approver_id, action,
      comment: comment || null, attachments: attachmentsArr, created_at: now
    };
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM approval_actions WHERE id = ?').get(id);
    if (row) {
      const result = { ...row };
      if (result.attachments) {
        result.attachments = JSON.parse(result.attachments);
      }
      return result;
    }
    return row;
  }

  static findByContract(contract_id) {
    const rows = db.prepare('SELECT * FROM approval_actions WHERE contract_id = ? ORDER BY created_at').all(contract_id);
    return rows.map(row => {
      const result = { ...row };
      if (result.attachments) {
        result.attachments = JSON.parse(result.attachments);
      }
      const user = db.prepare('SELECT name, username FROM users WHERE id = ?').get(result.approver_id);
      if (user) {
        result.approver_name = user.name;
        result.approver_username = user.username;
      }
      return result;
    });
  }

  static findByStep(step_id) {
    const rows = db.prepare('SELECT * FROM approval_actions WHERE step_id = ? ORDER BY created_at').all(step_id);
    return rows.map(row => {
      const result = { ...row };
      if (result.attachments) {
        result.attachments = JSON.parse(result.attachments);
      }
      const user = db.prepare('SELECT name, username FROM users WHERE id = ?').get(result.approver_id);
      if (user) {
        result.approver_name = user.name;
        result.approver_username = user.username;
      }
      return result;
    });
  }

  static countApprovalsByStep(step_id) {
    const rows = db.prepare(`
      SELECT * FROM approval_actions
      WHERE step_id = ? AND action = 'approve'
    `).all(step_id);
    return rows.length;
  }

  static hasUserApproved(step_id, approver_id) {
    const rows = db.prepare(`
      SELECT * FROM approval_actions
      WHERE step_id = ? AND approver_id = ? AND action IN ('approve', 'reject', 'reject_all')
    `).all(step_id, approver_id);
    return rows.length > 0;
  }
}

module.exports = ApprovalAction;
