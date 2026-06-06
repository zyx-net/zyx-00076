const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class AuditLog {
  static create({ contract_id, user_id, action, old_value, new_value, ip_address }) {
    const id = uuidv4();
    const now = Date.now();
    const oldStr = old_value ? (typeof old_value === 'string' ? old_value : JSON.stringify(old_value)) : null;
    const newStr = new_value ? (typeof new_value === 'string' ? new_value : JSON.stringify(new_value)) : null;
    
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, contract_id, user_id, action, old_value, new_value, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, contract_id || null, user_id, action, oldStr, newStr, ip_address || null, now);
    return id;
  }

  static findByContract(contract_id) {
    const rows = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE contract_id = ?
      ORDER BY created_at
    `).all(contract_id);
    return rows.map(row => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
      let old_value = row.old_value;
      let new_value = row.new_value;
      if (old_value) {
        try { old_value = JSON.parse(old_value); } catch (e) {}
      }
      if (new_value) {
        try { new_value = JSON.parse(new_value); } catch (e) {}
      }
      return {
        ...row,
        old_value,
        new_value,
        user_name: user ? user.name : null,
        user_username: user ? user.username : null
      };
    });
  }

  static findByUser(user_id) {
    const rows = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(user_id);
    return rows.map(row => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
      return {
        ...row,
        user_name: user ? user.name : null,
        user_username: user ? user.username : null
      };
    });
  }

  static findAll(limit = 100) {
    const rows = db.prepare(`
      SELECT * FROM audit_logs 
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    return rows.map(row => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
      return {
        ...row,
        user_name: user ? user.name : null,
        user_username: user ? user.username : null
      };
    });
  }
}

module.exports = AuditLog;
