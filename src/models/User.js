const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class User {
  static create({ username, name, email, roles, department_id }) {
    const id = uuidv4();
    const now = Date.now();
    const rolesArr = Array.isArray(roles) ? roles : JSON.parse(roles);
    const rolesStr = JSON.stringify(rolesArr);
    
    const stmt = db.prepare(`
      INSERT INTO users (id, username, name, email, roles, department_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    stmt.run(id, username, name, email, rolesStr, department_id, now);
    return { id, username, name, email, roles: rolesArr, department_id: department_id || null, created_at: now, is_active: 1 };
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (row) {
      return { ...row, roles: JSON.parse(row.roles) };
    }
    return row;
  }

  static findByUsername(username) {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (row) {
      return { ...row, roles: JSON.parse(row.roles) };
    }
    return row;
  }

  static findAll() {
    const rows = db.prepare('SELECT * FROM users WHERE is_active = 1').all();
    return rows.map(row => ({ ...row, roles: JSON.parse(row.roles) }));
  }

  static findByRole(role) {
    const rows = db.prepare('SELECT * FROM users WHERE is_active = 1').all();
    return rows.filter(row => {
      const roles = JSON.parse(row.roles);
      return roles.includes(role);
    });
  }

  static hasRole(userId, role) {
    const user = this.findById(userId);
    return user && user.roles.includes(role);
  }
}

module.exports = User;
