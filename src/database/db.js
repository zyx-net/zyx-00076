const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/db.json');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const TABLE_SCHEMAS = {
  users: [
    'id TEXT PRIMARY KEY',
    'username TEXT UNIQUE NOT NULL',
    'name TEXT NOT NULL',
    'email TEXT',
    'roles TEXT NOT NULL',
    'department_id TEXT',
    'created_at INTEGER NOT NULL',
    'is_active INTEGER DEFAULT 1'
  ],
  departments: [
    'id TEXT PRIMARY KEY',
    'name TEXT UNIQUE NOT NULL',
    'code TEXT UNIQUE NOT NULL',
    'parent_id TEXT',
    'created_at INTEGER NOT NULL'
  ],
  approval_rules: [
    'id TEXT PRIMARY KEY',
    'version INTEGER NOT NULL DEFAULT 1',
    'name TEXT NOT NULL',
    'description TEXT',
    'conditions TEXT NOT NULL',
    'steps TEXT NOT NULL',
    'priority INTEGER NOT NULL DEFAULT 0',
    'is_active INTEGER DEFAULT 1',
    'created_by TEXT NOT NULL',
    'created_at INTEGER NOT NULL',
    'effective_from INTEGER',
    'effective_to INTEGER'
  ],
  contracts: [
    'id TEXT PRIMARY KEY',
    'contract_no TEXT UNIQUE NOT NULL',
    'title TEXT NOT NULL',
    'amount REAL NOT NULL DEFAULT 0',
    'currency TEXT DEFAULT \'CNY\'',
    'department_id TEXT NOT NULL',
    'risk_level TEXT NOT NULL DEFAULT \'medium\'',
    'content TEXT',
    'applicant_id TEXT NOT NULL',
    'status TEXT NOT NULL DEFAULT \'draft\'',
    'rule_id TEXT',
    'rule_version INTEGER',
    'rule_hit_reason TEXT',
    'current_step_id TEXT',
    'created_at INTEGER NOT NULL',
    'updated_at INTEGER NOT NULL',
    'archived_at INTEGER',
    'archive_path TEXT'
  ],
  contract_attachments: [
    'id TEXT PRIMARY KEY',
    'contract_id TEXT NOT NULL',
    'file_name TEXT NOT NULL',
    'file_type TEXT',
    'file_size INTEGER DEFAULT 0',
    'file_path TEXT',
    'uploaded_by TEXT NOT NULL',
    'uploaded_at INTEGER NOT NULL',
    'is_required INTEGER DEFAULT 1'
  ],
  approval_steps: [
    'id TEXT PRIMARY KEY',
    'contract_id TEXT NOT NULL',
    'step_order INTEGER NOT NULL',
    'step_name TEXT NOT NULL',
    'step_type TEXT NOT NULL',
    'required_roles TEXT NOT NULL',
    'required_signatures INTEGER DEFAULT 1',
    'status TEXT NOT NULL DEFAULT \'pending\'',
    'assigned_to TEXT',
    'started_at INTEGER',
    'completed_at INTEGER'
  ],
  approval_actions: [
    'id TEXT PRIMARY KEY',
    'contract_id TEXT NOT NULL',
    'step_id TEXT NOT NULL',
    'approver_id TEXT NOT NULL',
    'action TEXT NOT NULL',
    'comment TEXT',
    'attachments TEXT',
    'created_at INTEGER NOT NULL'
  ],
  audit_logs: [
    'id TEXT PRIMARY KEY',
    'contract_id TEXT',
    'user_id TEXT NOT NULL',
    'action TEXT NOT NULL',
    'old_value TEXT',
    'new_value TEXT',
    'ip_address TEXT',
    'created_at INTEGER NOT NULL'
  ],
  archives: [
    'id TEXT PRIMARY KEY',
    'contract_id TEXT UNIQUE NOT NULL',
    'archive_no TEXT UNIQUE NOT NULL',
    'file_path TEXT NOT NULL',
    'file_hash TEXT',
    'archived_by TEXT NOT NULL',
    'archived_at INTEGER NOT NULL'
  ],
  import_batches: [
    'id TEXT PRIMARY KEY',
    'user_id TEXT NOT NULL',
    'created_at INTEGER NOT NULL',
    'summary TEXT NOT NULL',
    'rules_summary TEXT NOT NULL',
    'results TEXT',
    'config_switches TEXT NOT NULL',
    'undo_status TEXT DEFAULT \'none\'',
    'undo_at INTEGER',
    'undo_by TEXT',
    'undo_results TEXT'
  ],
  sla_configs: [
    'id TEXT PRIMARY KEY',
    'name TEXT NOT NULL',
    'risk_level TEXT',
    'department_id TEXT',
    'min_amount REAL',
    'max_amount REAL',
    'step_name TEXT',
    'deadline_hours INTEGER NOT NULL',
    'first_reminder_hours INTEGER',
    'second_reminder_hours INTEGER',
    'escalation_hours INTEGER',
    'escalation_roles TEXT',
    'priority INTEGER NOT NULL DEFAULT 0',
    'is_active INTEGER DEFAULT 1',
    'created_by TEXT NOT NULL',
    'created_at INTEGER NOT NULL',
    'updated_at INTEGER NOT NULL'
  ],
  approval_deadlines: [
    'id TEXT PRIMARY KEY',
    'contract_id TEXT NOT NULL',
    'step_id TEXT NOT NULL',
    'step_name TEXT NOT NULL',
    'sla_config_id TEXT NOT NULL',
    'approver_roles TEXT NOT NULL',
    'started_at INTEGER NOT NULL',
    'deadline_hours INTEGER NOT NULL',
    'deadline_at INTEGER NOT NULL',
    'first_reminder_at INTEGER',
    'second_reminder_at INTEGER',
    'escalation_at INTEGER',
    'first_reminder_sent INTEGER DEFAULT 0',
    'second_reminder_sent INTEGER DEFAULT 0',
    'escalation_sent INTEGER DEFAULT 0',
    'status TEXT NOT NULL DEFAULT \'active\'',
    'paused_at INTEGER',
    'paused_by TEXT',
    'pause_reason TEXT',
    'closed_at INTEGER',
    'close_reason TEXT',
    'created_at INTEGER NOT NULL',
    'updated_at INTEGER NOT NULL'
  ],
  deadline_audit_logs: [
    'id TEXT PRIMARY KEY',
    'deadline_id TEXT NOT NULL',
    'contract_id TEXT NOT NULL',
    'step_id TEXT NOT NULL',
    'user_id TEXT',
    'action TEXT NOT NULL',
    'reason TEXT',
    'old_status TEXT',
    'new_status TEXT',
    'old_value TEXT',
    'new_value TEXT',
    'ip_address TEXT',
    'created_at INTEGER NOT NULL'
  ]
};

class JsonDatabase {
  constructor() {
    this.data = this.load();
    this.transactionQueue = [];
    this.saveTimeout = null;
  }

  load() {
    if (fs.existsSync(dbPath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        return this.data;
      } catch (e) {
        console.warn('数据库文件损坏，将重建:', e.message);
      }
    }
    
    const initialData = {};
    for (const table of Object.keys(TABLE_SCHEMAS)) {
      initialData[table] = [];
    }
    this.data = initialData;
    this.save(initialData);
    return this.data;
  }

  save(data = this.data) {
    const tempPath = dbPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, dbPath);
  }

  forceSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.save();
  }

  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 100);
  }

  exec(sql) {
    const trimmed = sql.trim();
    if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('CREATE INDEX') || 
        trimmed.startsWith('PRAGMA')) {
      return;
    }
    
    if (trimmed === 'BEGIN') {
      this.transactionQueue = [];
      return;
    }
    
    if (trimmed === 'COMMIT') {
      this.transactionQueue = [];
      this.save();
      return;
    }
    
    if (trimmed === 'ROLLBACK') {
      this.transactionQueue.forEach(op => {
        Object.assign(this.data, op.oldData);
      });
      this.transactionQueue = [];
      this.save();
      return;
    }
    
    throw new Error('Raw SQL execution not supported in JSON store');
  }

  prepare(sql) {
    const trimmed = sql.trim();
    
    if (trimmed.startsWith('SELECT')) {
      return new JsonStatement(this, 'SELECT', trimmed);
    }
    if (trimmed.startsWith('INSERT')) {
      return new JsonStatement(this, 'INSERT', trimmed);
    }
    if (trimmed.startsWith('UPDATE')) {
      return new JsonStatement(this, 'UPDATE', trimmed);
    }
    if (trimmed.startsWith('DELETE')) {
      return new JsonStatement(this, 'DELETE', trimmed);
    }
    
    throw new Error(`Unsupported SQL: ${sql}`);
  }

  pragma() {
  }
}

class JsonStatement {
  constructor(db, type, sql) {
    this.db = db;
    this.type = type;
    this.sql = sql;
    this.params = [];
  }

  run(...args) {
    this.params = args;
    return this.execute();
  }

  get(...args) {
    this.params = args;
    const result = this.execute();
    return result[0] || undefined;
  }

  all(...args) {
    this.params = args;
    return this.execute();
  }

  execute() {
    if (this.type === 'INSERT') {
      return this.executeInsert();
    } else if (this.type === 'SELECT') {
      return this.executeSelect();
    } else if (this.type === 'UPDATE') {
      return this.executeUpdate();
    } else if (this.type === 'DELETE') {
      return this.executeDelete();
    }
    return [];
  }

  getParam(idx) {
    return this.params[idx];
  }

  parseTable(sql) {
    const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
    return tableMatch ? tableMatch[1] : null;
  }

  parseColumns(sql) {
    const insertMatch = sql.match(/INSERT INTO \w+\s*\(([^)]+)\)/i);
    if (insertMatch) {
      return insertMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));
    }
    return [];
  }

  parseValues(sql) {
    const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
    if (valuesMatch) {
      return valuesMatch[1].split(',').map(v => v.trim());
    }
    return [];
  }

  parseSet(sql) {
    const setMatch = sql.match(/SET\s+(.+?)(?:WHERE|$)/is);
    if (setMatch) {
      const parts = setMatch[1].split(',').map(p => p.trim());
      return parts.map(p => {
        const [col, val] = p.split('=').map(s => s.trim());
        return { col: col.replace(/`/g, ''), val };
      });
    }
    return [];
  }

  parseWhere(sql) {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/is);
    if (!whereMatch) return null;
    return whereMatch[1].trim();
  }

  parseOrderBy(sql) {
    const orderMatch = sql.match(/ORDER BY\s+(.+?)(?:LIMIT|$)/is);
    if (!orderMatch) return null;
    const parts = orderMatch[1].trim().split(/\s+/);
    return { col: parts[0], dir: (parts[1] || 'ASC').toUpperCase() };
  }

  parseLimit(sql) {
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    return limitMatch ? parseInt(limitMatch[1]) : null;
  }

  evaluateCondition(condition, row, params) {
    if (!condition) return true;
    
    const parts = condition.split(/\s+(AND|OR)\s+/i);
    let result = true;
    let operator = 'AND';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part.toUpperCase() === 'AND' || part.toUpperCase() === 'OR') {
        operator = part.toUpperCase();
        continue;
      }
      
      const match = part.match(/(\w+)\s*(=|!=|<>|>=|<=|>|<|IS NULL|IS NOT NULL|LIKE|IN)\s*(.+)?/i);
      if (!match) continue;
      
      let [, col, op, val] = match;
      col = col.replace(/`/g, '');
      op = op.toUpperCase();
      
      let rowVal = row[col];
      let compareVal;
      
      if (val === '?') {
        compareVal = params.shift();
      } else if (val && val.startsWith('?')) {
        const idx = parseInt(val.slice(1)) - 1;
        compareVal = params[idx];
      } else if (val && val.startsWith("'") && val.endsWith("'")) {
        compareVal = val.slice(1, -1);
      } else if (val && /^\d+$/.test(val)) {
        compareVal = parseInt(val);
      } else if (val && /^\d+\.\d+$/.test(val)) {
        compareVal = parseFloat(val);
      } else if (val === 'NULL') {
        compareVal = null;
      } else if (val && val.startsWith('(') && val.endsWith(')')) {
        compareVal = val.slice(1, -1).split(',').map(v => {
          v = v.trim().replace(/'/g, '');
          if (v === '?') {
            return params.shift();
          } else if (v.startsWith('?')) {
            const idx = parseInt(v.slice(1)) - 1;
            return params[idx];
          } else if (/^\d+$/.test(v)) {
            return parseInt(v);
          } else if (/^\d+\.\d+$/.test(v)) {
            return parseFloat(v);
          }
          return v;
        });
      } else {
        compareVal = val;
      }
      
      let partResult = false;
      switch (op) {
        case '=':
          partResult = rowVal === compareVal;
          break;
        case '!=':
        case '<>':
          partResult = rowVal !== compareVal;
          break;
        case '>':
          partResult = rowVal > compareVal;
          break;
        case '>=':
          partResult = rowVal >= compareVal;
          break;
        case '<':
          partResult = rowVal < compareVal;
          break;
        case '<=':
          partResult = rowVal <= compareVal;
          break;
        case 'IS NULL':
          partResult = rowVal === null || rowVal === undefined;
          break;
        case 'IS NOT NULL':
          partResult = rowVal !== null && rowVal !== undefined;
          break;
        case 'IN':
          partResult = Array.isArray(compareVal) && compareVal.includes(rowVal);
          break;
        case 'LIKE':
          const pattern = compareVal.replace(/%/g, '.*');
          partResult = new RegExp(`^${pattern}$`).test(rowVal);
          break;
      }
      
      if (i === 0 || operator === 'AND') {
        result = result && partResult;
      } else {
        result = result || partResult;
      }
    }
    
    return result;
  }

  executeInsert() {
    const table = this.parseTable(this.sql);
    const columns = this.parseColumns(this.sql);
    const values = this.parseValues(this.sql);
    
    const row = {};
    let paramIdx = 0;
    
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const val = values[i].trim();
      
      if (val === '?') {
        row[col] = this.getParam(paramIdx++);
      } else if (val === 'NULL') {
        row[col] = null;
      } else if (val.startsWith("'") && val.endsWith("'")) {
        row[col] = val.slice(1, -1);
      } else if (/^\d+$/.test(val)) {
        row[col] = parseInt(val);
      } else if (/^\d+\.\d+$/.test(val)) {
        row[col] = parseFloat(val);
      } else {
        row[col] = val;
      }
    }
    
    if (!this.db.data[table]) {
      this.db.data[table] = [];
    }
    
    const oldData = JSON.parse(JSON.stringify(this.db.data));
    this.db.data[table].push(row);
    this.db.scheduleSave();
    
    if (this.db.transactionQueue.length > 0) {
      this.db.transactionQueue.push({ oldData });
    }
    
    return { changes: 1, lastInsertRowid: row.id };
  }

  executeSelect() {
    const table = this.parseTable(this.sql);
    const where = this.parseWhere(this.sql);
    const orderBy = this.parseOrderBy(this.sql);
    const limit = this.parseLimit(this.sql);
    
    if (!this.db.data[table]) return [];
    
    let results = [...this.db.data[table]];
    
    if (where) {
      results = results.filter(row => this.evaluateCondition(where, row, [...this.params]));
    }
    
    if (orderBy) {
      results.sort((a, b) => {
        let valA = a[orderBy.col];
        let valB = b[orderBy.col];
        
        if (typeof valA === 'string' && typeof valB === 'string') {
          return orderBy.dir === 'ASC' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return orderBy.dir === 'ASC' ? valA - valB : valB - valA;
      });
    }
    
    if (limit !== null) {
      results = results.slice(0, limit);
    }
    
    return results;
  }

  executeUpdate() {
    const table = this.parseTable(this.sql);
    const sets = this.parseSet(this.sql);
    const where = this.parseWhere(this.sql);
    
    if (!this.db.data[table]) return { changes: 0 };
    
    const oldData = JSON.parse(JSON.stringify(this.db.data));
    const params = [...this.params];
    let count = 0;
    
    const setParamCount = sets.filter(s => s.val === '?').length;
    const whereParams = params.slice(setParamCount);
    let setParamIndex = 0;
    
    for (const row of this.db.data[table]) {
      if (where && !this.evaluateCondition(where, row, [...whereParams])) {
        continue;
      }
      
      setParamIndex = 0;
      for (const set of sets) {
        if (set.val === '?') {
          row[set.col] = params[setParamIndex++];
        } else if (set.val === 'NULL') {
          row[set.col] = null;
        } else if (set.val.startsWith("'") && set.val.endsWith("'")) {
          row[set.col] = set.val.slice(1, -1);
        } else if (/^\d+$/.test(set.val)) {
          row[set.col] = parseInt(set.val);
        } else if (/^\d+\.\d+$/.test(set.val)) {
          row[set.col] = parseFloat(set.val);
        } else {
          row[set.col] = set.val;
        }
      }
      count++;
    }
    
    this.db.scheduleSave();
    
    if (this.db.transactionQueue.length > 0) {
      this.db.transactionQueue.push({ oldData });
    }
    
    return { changes: count };
  }

  executeDelete() {
    const table = this.parseTable(this.sql);
    const where = this.parseWhere(this.sql);
    
    if (!this.db.data[table]) return { changes: 0 };
    
    const oldData = JSON.parse(JSON.stringify(this.db.data));
    const params = [...this.params];
    let count = 0;
    
    if (where) {
      const before = this.db.data[table].length;
      this.db.data[table] = this.db.data[table].filter(row => 
        !this.evaluateCondition(where, row, [...params])
      );
      count = before - this.db.data[table].length;
    } else {
      count = this.db.data[table].length;
      this.db.data[table] = [];
    }
    
    this.db.scheduleSave();
    
    if (this.db.transactionQueue.length > 0) {
      this.db.transactionQueue.push({ oldData });
    }
    
    return { changes: count };
  }
}

const db = new JsonDatabase();

function initDatabase() {
  for (const table of Object.keys(TABLE_SCHEMAS)) {
    if (!db.data[table]) {
      db.data[table] = [];
    }
  }
  db.save();
}

initDatabase();

module.exports = db;
