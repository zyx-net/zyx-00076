const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

const ACTION_TYPES = {
  CREATED: 'created',
  FIRST_REMINDER: 'first_reminder',
  SECOND_REMINDER: 'second_reminder',
  ESCALATION: 'escalation',
  MANUAL_REMINDER: 'manual_reminder',
  PAUSED: 'paused',
  RESUMED: 'resumed',
  COMPLETED: 'completed',
  CLOSED: 'closed',
  RECALCULATED: 'recalculated'
};

class DeadlineAuditLog {
  static create({ deadline_id, contract_id, step_id, user_id, action, reason, old_status, new_status, old_value, new_value, ip_address }) {
    const id = uuidv4();
    const now = Date.now();
    
    const oldValStr = old_value ? (typeof old_value === 'string' ? old_value : JSON.stringify(old_value)) : null;
    const newValStr = new_value ? (typeof new_value === 'string' ? new_value : JSON.stringify(new_value)) : null;

    const stmt = db.prepare(`
      INSERT INTO deadline_audit_logs (
        id, deadline_id, contract_id, step_id, user_id, action, reason,
        old_status, new_status, old_value, new_value, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id, deadline_id, contract_id, step_id, user_id || null, action, reason || null,
      old_status || null, new_status || null, oldValStr, newValStr, ip_address || null, now
    );

    return id;
  }

  static findByDeadline(deadlineId) {
    const rows = db.prepare(`
      SELECT * FROM deadline_audit_logs 
      WHERE deadline_id = ?
      ORDER BY created_at DESC
    `).all(deadlineId);
    return this._parseRows(rows);
  }

  static findByContract(contractId) {
    const rows = db.prepare(`
      SELECT * FROM deadline_audit_logs 
      WHERE contract_id = ?
      ORDER BY created_at DESC
    `).all(contractId);
    return this._parseRows(rows);
  }

  static findByUser(userId, limit = 100) {
    const rows = db.prepare(`
      SELECT * FROM deadline_audit_logs 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);
    return this._parseRows(rows);
  }

  static findAll(limit = 100) {
    const rows = db.prepare(`
      SELECT * FROM deadline_audit_logs 
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    return this._parseRows(rows);
  }

  static _parseRows(rows) {
    return rows.map(row => this._parseRow(row));
  }

  static _parseRow(row) {
    if (!row) return row;
    
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
      action_label: this._getActionLabel(row.action)
    };
  }

  static _getActionLabel(action) {
    const labels = {
      [ACTION_TYPES.CREATED]: '创建时限',
      [ACTION_TYPES.FIRST_REMINDER]: '首次催办',
      [ACTION_TYPES.SECOND_REMINDER]: '二次催办',
      [ACTION_TYPES.ESCALATION]: '升级上报',
      [ACTION_TYPES.MANUAL_REMINDER]: '手动催办',
      [ACTION_TYPES.PAUSED]: '暂停时限',
      [ACTION_TYPES.RESUMED]: '恢复时限',
      [ACTION_TYPES.COMPLETED]: '审批完成',
      [ACTION_TYPES.CLOSED]: '关闭时限',
      [ACTION_TYPES.RECALCULATED]: '重新计算'
    };
    return labels[action] || action;
  }
}

DeadlineAuditLog.ACTION_TYPES = ACTION_TYPES;

module.exports = DeadlineAuditLog;
