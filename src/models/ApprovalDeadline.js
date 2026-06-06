const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

const DEADLINE_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CLOSED: 'closed'
};

const CLOSE_REASONS = {
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  SUPPLEMENT: 'supplement_requested',
  REJECT_ALL: 'reject_all',
  ARCHIVED: 'archived',
  REFLOW: 'reflow',
  CANCELLED: 'cancelled'
};

class ApprovalDeadline {
  static create({ contract_id, step_id, step_name, sla_config_id, approver_roles, started_at, deadline_hours, deadline_at, first_reminder_at, second_reminder_at, escalation_at }) {
    const id = uuidv4();
    const now = Date.now();
    const rolesStr = Array.isArray(approver_roles) ? JSON.stringify(approver_roles) : approver_roles;

    const stmt = db.prepare(`
      INSERT INTO approval_deadlines (
        id, contract_id, step_id, step_name, sla_config_id, approver_roles,
        started_at, deadline_hours, deadline_at, first_reminder_at, second_reminder_at, escalation_at,
        first_reminder_sent, second_reminder_sent, escalation_sent,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);

    stmt.run(
      id, contract_id, step_id, step_name, sla_config_id, rolesStr,
      started_at, deadline_hours, deadline_at, first_reminder_at || null, second_reminder_at || null, escalation_at || null,
      0, 0, 0,
      now, now
    );

    return this.findById(id);
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM approval_deadlines WHERE id = ?').get(id);
    if (row) {
      return this._parseRow(row);
    }
    return row;
  }

  static findByContract(contractId) {
    const rows = db.prepare('SELECT * FROM approval_deadlines WHERE contract_id = ? ORDER BY created_at DESC').all(contractId);
    return rows.map(row => this._parseRow(row));
  }

  static findByStep(stepId) {
    const rows = db.prepare('SELECT * FROM approval_deadlines WHERE step_id = ? ORDER BY created_at DESC').all(stepId);
    return rows.map(row => this._parseRow(row));
  }

  static findActiveByStep(stepId) {
    const rows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE step_id = ? AND status IN ('active', 'paused')
      ORDER BY created_at DESC
    `).all(stepId);
    return rows.map(row => this._parseRow(row));
  }

  static findActiveByContract(contractId) {
    const rows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE contract_id = ? AND status IN ('active', 'paused')
      ORDER BY created_at DESC
    `).all(contractId);
    return rows.map(row => this._parseRow(row));
  }

  static findByApproverRole(roles) {
    const roleArray = Array.isArray(roles) ? roles : [roles];
    const allRows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE status IN ('active', 'paused')
      ORDER BY deadline_at ASC
    `).all();

    return allRows
      .map(row => this._parseRow(row))
      .filter(row => {
        return row.approver_roles.some(role => roleArray.includes(role));
      });
  }

  static findOverdue(now = Date.now()) {
    const rows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE status = 'active' AND deadline_at < ?
      ORDER BY deadline_at ASC
    `).all(now);
    return rows.map(row => this._parseRow(row));
  }

  static findForFirstReminder(now = Date.now()) {
    const rows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE status = ? 
        AND first_reminder_sent = ? 
        AND first_reminder_at IS NOT NULL 
        AND first_reminder_at < ?
      ORDER BY first_reminder_at ASC
    `).all('active', 0, now);
    return rows.map(row => this._parseRow(row));
  }

  static findForSecondReminder(now = Date.now()) {
    const rows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE status = ? 
        AND second_reminder_sent = ? 
        AND second_reminder_at IS NOT NULL 
        AND second_reminder_at < ?
      ORDER BY second_reminder_at ASC
    `).all('active', 0, now);
    return rows.map(row => this._parseRow(row));
  }

  static findForEscalation(now = Date.now()) {
    const rows = db.prepare(`
      SELECT * FROM approval_deadlines 
      WHERE status = ? 
        AND escalation_sent = ? 
        AND escalation_at IS NOT NULL 
        AND escalation_at < ?
      ORDER BY escalation_at ASC
    `).all('active', 0, now);
    return rows.map(row => this._parseRow(row));
  }

  static findAll(filter = {}) {
    let sql = 'SELECT * FROM approval_deadlines';
    const conditions = [];
    const params = [];

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.contract_id) {
      conditions.push('contract_id = ?');
      params.push(filter.contract_id);
    }
    if (filter.is_overdue) {
      conditions.push('deadline_at < ?');
      params.push(Date.now());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY deadline_at ASC';

    const rows = db.prepare(sql).all(...params);
    return rows.map(row => this._parseRow(row));
  }

  static markFirstReminderSent(id) {
    const now = Date.now();
    db.prepare(`
      UPDATE approval_deadlines 
      SET first_reminder_sent = ?, updated_at = ? 
      WHERE id = ?
    `).run(1, now, id);
    return this.findById(id);
  }

  static markSecondReminderSent(id) {
    const now = Date.now();
    db.prepare(`
      UPDATE approval_deadlines 
      SET second_reminder_sent = ?, updated_at = ? 
      WHERE id = ?
    `).run(1, now, id);
    return this.findById(id);
  }

  static markEscalationSent(id) {
    const now = Date.now();
    db.prepare(`
      UPDATE approval_deadlines 
      SET escalation_sent = ?, updated_at = ? 
      WHERE id = ?
    `).run(1, now, id);
    return this.findById(id);
  }

  static pause(id, userId, reason) {
    const now = Date.now();
    const existing = this.findById(id);
    if (!existing) {
      throw new Error('时限记录不存在');
    }
    if (existing.status !== DEADLINE_STATUSES.ACTIVE) {
      throw new Error(`当前状态 [${existing.status}] 不允许暂停`);
    }

    db.prepare(`
      UPDATE approval_deadlines 
      SET status = 'paused', paused_at = ?, paused_by = ?, pause_reason = ?, updated_at = ? 
      WHERE id = ?
    `).run(now, userId, reason || null, now, id);

    return this.findById(id);
  }

  static resume(id, userId) {
    const now = Date.now();
    const existing = this.findById(id);
    if (!existing) {
      throw new Error('时限记录不存在');
    }
    if (existing.status !== DEADLINE_STATUSES.PAUSED) {
      throw new Error(`当前状态 [${existing.status}] 不允许恢复`);
    }

    db.prepare(`
      UPDATE approval_deadlines 
      SET status = 'active', paused_at = NULL, paused_by = NULL, pause_reason = NULL, updated_at = ? 
      WHERE id = ?
    `).run(now, id);

    return this.findById(id);
  }

  static close(id, reason) {
    const now = Date.now();
    const existing = this.findById(id);
    if (!existing) {
      throw new Error('时限记录不存在');
    }
    if (existing.status === DEADLINE_STATUSES.CLOSED || existing.status === DEADLINE_STATUSES.COMPLETED) {
      return existing;
    }

    db.prepare(`
      UPDATE approval_deadlines 
      SET status = 'closed', closed_at = ?, close_reason = ?, updated_at = ? 
      WHERE id = ?
    `).run(now, reason, now, id);

    return this.findById(id);
  }

  static complete(id) {
    const now = Date.now();
    const existing = this.findById(id);
    if (!existing) {
      throw new Error('时限记录不存在');
    }

    db.prepare(`
      UPDATE approval_deadlines 
      SET status = 'completed', closed_at = ?, close_reason = 'completed', updated_at = ? 
      WHERE id = ?
    `).run(now, now, id);

    return this.findById(id);
  }

  static closeActiveByContract(contractId, reason) {
    const active = this.findActiveByContract(contractId);
    const closed = [];
    for (const deadline of active) {
      closed.push(this.close(deadline.id, reason));
    }
    return closed;
  }

  static closeActiveByStep(stepId, reason) {
    const active = this.findActiveByStep(stepId);
    const closed = [];
    for (const deadline of active) {
      closed.push(this.close(deadline.id, reason));
    }
    return closed;
  }

  static _parseRow(row) {
    if (!row) return row;
    const now = Date.now();
    return {
      ...row,
      deadline_hours: Number(row.deadline_hours),
      approver_roles: JSON.parse(row.approver_roles),
      first_reminder_sent: Number(row.first_reminder_sent) === 1,
      second_reminder_sent: Number(row.second_reminder_sent) === 1,
      escalation_sent: Number(row.escalation_sent) === 1,
      is_overdue: Number(row.deadline_at) < now,
      remaining_hours: Math.max(0, Math.round((Number(row.deadline_at) - now) / (1000 * 60 * 60) * 10) / 10)
    };
  }
}

ApprovalDeadline.STATUSES = DEADLINE_STATUSES;
ApprovalDeadline.CLOSE_REASONS = CLOSE_REASONS;

module.exports = ApprovalDeadline;
