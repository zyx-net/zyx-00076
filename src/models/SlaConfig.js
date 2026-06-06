const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

class SlaConfig {
  static validate({ name, risk_level, department_id, min_amount, max_amount, step_name, deadline_hours, first_reminder_hours, second_reminder_hours, escalation_hours, escalation_roles }) {
    const errors = [];

    if (!name || name.trim().length === 0) {
      errors.push('SLA名称不能为空');
    }

    if (risk_level && !VALID_RISK_LEVELS.includes(risk_level)) {
      errors.push(`风险等级必须是以下值之一: ${VALID_RISK_LEVELS.join(', ')}`);
    }

    if (min_amount !== undefined && min_amount !== null && min_amount < 0) {
      errors.push('最小金额不能为负数');
    }

    if (max_amount !== undefined && max_amount !== null && max_amount < 0) {
      errors.push('最大金额不能为负数');
    }

    if (min_amount !== undefined && min_amount !== null && max_amount !== undefined && max_amount !== null && min_amount > max_amount) {
      errors.push('最小金额不能大于最大金额');
    }

    if (!deadline_hours || deadline_hours <= 0) {
      errors.push('审批时限必须大于0小时');
    }

    if (first_reminder_hours !== undefined && first_reminder_hours !== null) {
      if (first_reminder_hours <= 0) {
        errors.push('首次催办时间必须大于0小时');
      }
      if (first_reminder_hours >= deadline_hours) {
        errors.push('首次催办时间必须小于审批时限');
      }
    }

    if (second_reminder_hours !== undefined && second_reminder_hours !== null) {
      if (second_reminder_hours <= 0) {
        errors.push('二次催办时间必须大于0小时');
      }
      if (first_reminder_hours && second_reminder_hours <= first_reminder_hours) {
        errors.push('二次催办时间必须大于首次催办时间');
      }
      if (second_reminder_hours >= deadline_hours) {
        errors.push('二次催办时间必须小于审批时限');
      }
    }

    if (escalation_hours !== undefined && escalation_hours !== null) {
      if (escalation_hours <= 0) {
        errors.push('升级时间必须大于0小时');
      }
      if (escalation_hours <= deadline_hours) {
        errors.push('升级时间必须大于审批时限（超时后才升级）');
      }
    }

    if (escalation_hours && (!escalation_roles || escalation_roles.length === 0)) {
      errors.push('配置了升级时间必须同时指定升级角色');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const validation = this.validate(data);
    if (!validation.valid) {
      throw new Error(`SLA配置验证失败: ${validation.errors.join('; ')}`);
    }

    const id = uuidv4();
    const now = Date.now();
    const escalationRolesStr = data.escalation_roles 
      ? (Array.isArray(data.escalation_roles) ? JSON.stringify(data.escalation_roles) : data.escalation_roles)
      : null;

    const stmt = db.prepare(`
      INSERT INTO sla_configs (
        id, name, risk_level, department_id, min_amount, max_amount, step_name,
        deadline_hours, first_reminder_hours, second_reminder_hours, 
        escalation_hours, escalation_roles, priority, is_active, 
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id, data.name, data.risk_level || null, data.department_id || null,
      data.min_amount !== undefined ? data.min_amount : null,
      data.max_amount !== undefined ? data.max_amount : null,
      data.step_name || null,
      data.deadline_hours,
      data.first_reminder_hours !== undefined ? data.first_reminder_hours : null,
      data.second_reminder_hours !== undefined ? data.second_reminder_hours : null,
      data.escalation_hours !== undefined ? data.escalation_hours : null,
      escalationRolesStr,
      data.priority || 0,
      1,
      data.created_by, now, now
    );

    return this.findById(id);
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM sla_configs WHERE id = ?').get(id);
    if (row) {
      return this._parseRow(row);
    }
    return row;
  }

  static findAll(activeOnly = false) {
    let sql = 'SELECT * FROM sla_configs';
    const params = [];
    if (activeOnly) {
      sql += ' WHERE is_active = ?';
      params.push(1);
    }
    sql += ' ORDER BY priority DESC, created_at DESC';
    const rows = db.prepare(sql).all(...params);
    return rows.map(row => this._parseRow(row));
  }

  static findMatching(contract, stepName = null) {
    const configs = this.findAll(true);
    
    const matching = configs.filter(config => {
      if (config.risk_level && config.risk_level !== contract.risk_level) {
        return false;
      }
      if (config.department_id && config.department_id !== contract.department_id) {
        return false;
      }
      if (config.min_amount !== null && contract.amount < config.min_amount) {
        return false;
      }
      if (config.max_amount !== null && contract.amount > config.max_amount) {
        return false;
      }
      if (config.step_name && stepName && config.step_name !== stepName) {
        return false;
      }
      return true;
    });

    return matching.sort((a, b) => b.priority - a.priority);
  }

  static findBestMatch(contract, stepName = null) {
    const matching = this.findMatching(contract, stepName);
    return matching[0] || null;
  }

  static update(id, data) {
    const existing = this.findById(id);
    if (!existing) {
      throw new Error('SLA配置不存在');
    }

    const merged = { ...existing, ...data };
    const validation = this.validate(merged);
    if (!validation.valid) {
      throw new Error(`SLA配置验证失败: ${validation.errors.join('; ')}`);
    }

    const now = Date.now();
    const updates = [];
    const params = [];

    const fields = ['name', 'risk_level', 'department_id', 'min_amount', 'max_amount', 
                    'step_name', 'deadline_hours', 'first_reminder_hours', 
                    'second_reminder_hours', 'escalation_hours', 'priority', 'is_active'];

    for (const field of fields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(data[field] !== null ? data[field] : null);
      }
    }

    if (data.escalation_roles !== undefined) {
      updates.push('escalation_roles = ?');
      params.push(data.escalation_roles 
        ? (Array.isArray(data.escalation_roles) ? JSON.stringify(data.escalation_roles) : data.escalation_roles)
        : null);
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    const sql = `UPDATE sla_configs SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);

    return this.findById(id);
  }

  static deactivate(id) {
    return this.update(id, { is_active: 0 });
  }

  static activate(id) {
    return this.update(id, { is_active: 1 });
  }

  static delete(id) {
    db.prepare('DELETE FROM sla_configs WHERE id = ?').run(id);
  }

  static _parseRow(row) {
    if (!row) return row;
    return {
      ...row,
      escalation_roles: row.escalation_roles ? JSON.parse(row.escalation_roles) : null,
      is_active: Number(row.is_active) === 1
    };
  }
}

module.exports = SlaConfig;
