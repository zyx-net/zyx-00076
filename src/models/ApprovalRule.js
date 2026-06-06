const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class ApprovalRule {
  static create({ name, description, conditions, steps, priority, created_by, effective_from, effective_to }) {
    const id = uuidv4();
    const now = Date.now();
    
    const existingRules = db.prepare('SELECT version FROM approval_rules WHERE name = ?').all(name);
    let maxVersion = 0;
    for (const rule of existingRules) {
      const v = Number(rule.version);
      if (!isNaN(v) && v > maxVersion) {
        maxVersion = v;
      }
    }
    const version = maxVersion + 1;
    
    const conditionsObj = typeof conditions === 'string' ? JSON.parse(conditions) : conditions;
    const stepsObj = typeof steps === 'string' ? JSON.parse(steps) : steps;
    const conditionsStr = JSON.stringify(conditionsObj);
    const stepsStr = JSON.stringify(stepsObj);
    
    const stmt = db.prepare(`
      INSERT INTO approval_rules (id, name, version, description, conditions, steps, priority, is_active, created_by, created_at, effective_from, effective_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, name, version, description || null, conditionsStr, stepsStr, priority || 0, 1, created_by, now, effective_from || null, effective_to || null);
    
    return {
      id, name, version, description: description || null,
      conditions: conditionsObj, steps: stepsObj,
      priority: priority || 0, is_active: 1,
      created_by, created_at: now,
      effective_from: effective_from || null,
      effective_to: effective_to || null
    };
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM approval_rules WHERE id = ?').get(id);
    if (row) {
      return {
        ...row,
        conditions: JSON.parse(row.conditions),
        steps: JSON.parse(row.steps)
      };
    }
    return row;
  }

  static findByName(name, version) {
    let row;
    if (version) {
      row = db.prepare('SELECT * FROM approval_rules WHERE name = ? AND version = ?').get(name, version);
    } else {
      row = db.prepare('SELECT * FROM approval_rules WHERE name = ? ORDER BY version DESC LIMIT 1').get(name);
    }
    if (row) {
      return {
        ...row,
        conditions: JSON.parse(row.conditions),
        steps: JSON.parse(row.steps)
      };
    }
    return row;
  }

  static findAllActive() {
    const now = Date.now();
    const rows = db.prepare(`
      SELECT * FROM approval_rules 
      WHERE is_active = 1 
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY priority DESC, version DESC
    `).all(now, now);
    return rows.map(row => ({
      ...row,
      conditions: JSON.parse(row.conditions),
      steps: JSON.parse(row.steps)
    }));
  }

  static findAll() {
    const rows = db.prepare('SELECT * FROM approval_rules ORDER BY name, version DESC').all();
    return rows.map(row => ({
      ...row,
      conditions: JSON.parse(row.conditions),
      steps: JSON.parse(row.steps)
    }));
  }

  static deactivate(id) {
    db.prepare('UPDATE approval_rules SET is_active = ? WHERE id = ?').run(0, id);
  }
}

module.exports = ApprovalRule;
