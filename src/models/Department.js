const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Department {
  static create({ name, code, parent_id }) {
    const id = uuidv4();
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO departments (id, name, code, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, name, code, parent_id, now);
    return { id, name, code, parent_id: parent_id || null, created_at: now };
  }

  static findById(id) {
    return db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  }

  static findByCode(code) {
    return db.prepare('SELECT * FROM departments WHERE code = ?').get(code);
  }

  static findAll() {
    return db.prepare('SELECT * FROM departments ORDER BY code').all();
  }
}

module.exports = Department;
