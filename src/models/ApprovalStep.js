const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class ApprovalStep {
  static create({ contract_id, step_order, step_name, step_type, required_roles, required_signatures, assigned_to }) {
    const id = uuidv4();
    const rolesArr = Array.isArray(required_roles) ? required_roles : JSON.parse(required_roles);
    const rolesStr = JSON.stringify(rolesArr);
    
    const stmt = db.prepare(`
      INSERT INTO approval_steps (id, contract_id, step_order, step_name, step_type, required_roles, required_signatures, assigned_to, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, contract_id, step_order, step_name, step_type, rolesStr, required_signatures || 1, assigned_to || null, 'pending');
    return {
      id, contract_id, step_order, step_name, step_type,
      required_roles: rolesArr, required_signatures: required_signatures || 1,
      status: 'pending', assigned_to: assigned_to || null,
      started_at: null, completed_at: null
    };
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM approval_steps WHERE id = ?').get(id);
    if (row) {
      return { ...row, required_roles: JSON.parse(row.required_roles) };
    }
    return row;
  }

  static findByContract(contract_id) {
    const rows = db.prepare('SELECT * FROM approval_steps WHERE contract_id = ? ORDER BY step_order').all(contract_id);
    return rows.map(row => ({ ...row, required_roles: JSON.parse(row.required_roles) }));
  }

  static findPendingByContract(contract_id) {
    const rows = db.prepare(`
      SELECT * FROM approval_steps 
      WHERE contract_id = ? AND status = 'pending'
      ORDER BY step_order LIMIT 1
    `).all(contract_id);
    return rows.map(row => ({ ...row, required_roles: JSON.parse(row.required_roles) }))[0];
  }

  static findByContractAndOrder(contract_id, step_order) {
    const row = db.prepare('SELECT * FROM approval_steps WHERE contract_id = ? AND step_order = ?').get(contract_id, step_order);
    if (row) {
      return { ...row, required_roles: JSON.parse(row.required_roles) };
    }
    return row;
  }

  static updateStatus(id, status) {
    const now = Date.now();
    const updates = ['status = ?'];
    const params = [status];
    
    if (status === 'in_progress') {
      updates.push('started_at = ?');
      params.push(now);
    } else if (status === 'completed' || status === 'rejected') {
      updates.push('completed_at = ?');
      params.push(now);
    }
    
    params.push(id);
    const sql = `UPDATE approval_steps SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);
    return this.findById(id);
  }

  static findByRole(role) {
    const rows = db.prepare(`
      SELECT * FROM approval_steps 
      WHERE status = 'pending' OR status = 'in_progress'
      ORDER BY step_order
    `).all();
    return rows.filter(row => {
      const roles = JSON.parse(row.required_roles);
      return roles.includes(role);
    }).map(row => ({ ...row, required_roles: JSON.parse(row.required_roles) }));
  }

  static deleteByContract(contract_id) {
    db.prepare('DELETE FROM approval_steps WHERE contract_id = ?').run(contract_id);
  }
}

module.exports = ApprovalStep;
