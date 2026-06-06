const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const User = require('./User');

class ImportBatch {
  static create({ id, user_id, summary, rules_summary, results, config_switches }) {
    const batchId = id || uuidv4();
    const now = Date.now();
    const summaryStr = typeof summary === 'string' ? summary : JSON.stringify(summary);
    const rulesSummaryStr = typeof rules_summary === 'string' ? rules_summary : JSON.stringify(rules_summary);
    const resultsStr = results ? (typeof results === 'string' ? results : JSON.stringify(results)) : null;
    const configStr = typeof config_switches === 'string' ? config_switches : JSON.stringify(config_switches);

    const stmt = db.prepare(`
      INSERT INTO import_batches (id, user_id, created_at, summary, rules_summary, results, config_switches, undo_status, undo_at, undo_by, undo_results)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(batchId, user_id, now, summaryStr, rulesSummaryStr, resultsStr, configStr, 'none', null, null, null);
    return batchId;
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(id);
    if (!row) return null;
    return this._parseRow(row);
  }

  static findAll(options = {}) {
    let sql = 'SELECT * FROM import_batches';
    const params = [];
    const where = [];

    if (options.user_id) {
      where.push('user_id = ?');
      params.push(options.user_id);
    }
    if (options.undo_status) {
      where.push('undo_status = ?');
      params.push(options.undo_status);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(row => this._parseRow(row));
  }

  static findByUser(user_id, limit = 100) {
    return this.findAll({ user_id, limit });
  }

  static updateUndoStatus(id, { undo_status, undo_by, undo_results }) {
    const now = Date.now();
    const undoResultsStr = undo_results ? (typeof undo_results === 'string' ? undo_results : JSON.stringify(undo_results)) : null;

    const stmt = db.prepare(`
      UPDATE import_batches 
      SET undo_status = ?, undo_at = ?, undo_by = ?, undo_results = ?
      WHERE id = ?
    `);
    stmt.run(undo_status, now, undo_by, undoResultsStr, id);
    return { changes: 1 };
  }

  static _parseRow(row) {
    const user = User.findById(row.user_id);
    const undoUser = row.undo_by ? User.findById(row.undo_by) : null;

    let summary = row.summary;
    let rules_summary = row.rules_summary;
    let results = row.results;
    let config_switches = row.config_switches;
    let undo_results = row.undo_results;

    try { if (summary) summary = JSON.parse(summary); } catch (e) {}
    try { if (rules_summary) rules_summary = JSON.parse(rules_summary); } catch (e) {}
    try { if (results) results = JSON.parse(results); } catch (e) {}
    try { if (config_switches) config_switches = JSON.parse(config_switches); } catch (e) {}
    try { if (undo_results) undo_results = JSON.parse(undo_results); } catch (e) {}

    return {
      id: row.id,
      user_id: row.user_id,
      user_name: user ? user.name : null,
      user_username: user ? user.username : null,
      created_at: row.created_at,
      summary,
      rules_summary,
      results,
      config_switches,
      undo_status: row.undo_status,
      undo_at: row.undo_at,
      undo_by: row.undo_by,
      undo_by_name: undoUser ? undoUser.name : null,
      undo_by_username: undoUser ? undoUser.username : null,
      undo_results
    };
  }
}

module.exports = ImportBatch;
