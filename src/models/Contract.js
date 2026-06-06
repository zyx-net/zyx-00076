const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Contract {
  static create({ contract_no, title, amount, currency, department_id, risk_level, content, applicant_id }) {
    const id = uuidv4();
    const now = Date.now();
    const data = {
      id, contract_no, title, amount: amount || 0, currency: currency || 'CNY',
      department_id, risk_level: risk_level || 'medium', content: content || null,
      applicant_id, status: 'draft', rule_id: null, rule_version: null,
      rule_hit_reason: null, current_step_id: null,
      created_at: now, updated_at: now, archived_at: null, archive_path: null
    };
    
    const stmt = db.prepare(`
      INSERT INTO contracts (id, contract_no, title, amount, currency, department_id, risk_level, content, applicant_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `);
    stmt.run(id, contract_no, title, amount || 0, currency || 'CNY', department_id, risk_level || 'medium', content || null, applicant_id, now, now);
    
    return data;
  }

  static findById(id) {
    return db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
  }

  static findByNo(contract_no) {
    return db.prepare('SELECT * FROM contracts WHERE contract_no = ?').get(contract_no);
  }

  static updateStatus(id, status, { rule_id, rule_version, rule_hit_reason, current_step_id, archived_at, archive_path } = {}) {
    const now = Date.now();
    const updates = [];
    const params = [];
    
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (rule_id !== undefined) {
      updates.push('rule_id = ?');
      params.push(rule_id);
    }
    if (rule_version !== undefined) {
      updates.push('rule_version = ?');
      params.push(rule_version);
    }
    if (rule_hit_reason !== undefined) {
      updates.push('rule_hit_reason = ?');
      params.push(rule_hit_reason);
    }
    if (current_step_id !== undefined) {
      updates.push('current_step_id = ?');
      params.push(current_step_id);
    }
    if (archived_at !== undefined) {
      updates.push('archived_at = ?');
      params.push(archived_at);
    }
    if (archive_path !== undefined) {
      updates.push('archive_path = ?');
      params.push(archive_path);
    }
    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);
    
    const sql = `UPDATE contracts SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);
    
    return this.findById(id);
  }

  static findByStatus(status) {
    return db.prepare('SELECT * FROM contracts WHERE status = ? ORDER BY created_at DESC').all(status);
  }

  static findByApplicant(applicant_id) {
    return db.prepare('SELECT * FROM contracts WHERE applicant_id = ? ORDER BY created_at DESC').all(applicant_id);
  }

  static findAll() {
    return db.prepare('SELECT * FROM contracts ORDER BY created_at DESC').all();
  }

  static addAttachment({ contract_id, file_name, file_type, file_size, file_path, uploaded_by, is_required }) {
    const id = uuidv4();
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO contract_attachments (id, contract_id, file_name, file_type, file_size, file_path, uploaded_by, uploaded_at, is_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, contract_id, file_name, file_type || null, file_size || 0, file_path || null, uploaded_by, now, is_required ? 1 : 0);
    return id;
  }

  static getAttachments(contract_id) {
    return db.prepare('SELECT * FROM contract_attachments WHERE contract_id = ? ORDER BY uploaded_at').all(contract_id);
  }
}

module.exports = Contract;
