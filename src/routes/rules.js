const express = require('express');
const Joi = require('joi');
const ApprovalRule = require('../models/ApprovalRule');
const RuleEngine = require('../services/RuleEngine');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Department = require('../models/Department');
const AuditLog = require('../models/AuditLog');

const router = express.Router();
router.use(authMiddleware);

const createRuleSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().allow(''),
  conditions: Joi.object().required(),
  steps: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    type: Joi.string().valid('single', 'countersign', 'any').required(),
    required_roles: Joi.array().items(Joi.string()).required(),
    required_signatures: Joi.number().min(1),
    assigned_to: Joi.string()
  })).required(),
  priority: Joi.number().default(0),
  effective_from: Joi.number(),
  effective_to: Joi.number()
});

router.post('/', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以创建规则' });
    }
    
    const { error, value } = createRuleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const validation = RuleEngine.validateRuleSteps(value);
    if (!validation.valid) {
      return res.status(400).json({ error: '规则步骤验证失败', details: validation.errors });
    }
    
    const rule = ApprovalRule.create({
      ...value,
      created_by: req.user.id
    });
    
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const { active } = req.query;
  let rules;
  
  if (active === 'true') {
    rules = ApprovalRule.findAllActive();
  } else {
    rules = ApprovalRule.findAll();
  }
  
  res.json(rules);
});

router.get('/export', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以导出规则' });
    }

    const activeRules = ApprovalRule.findAllActive();
    const exportData = {
      exported_at: Date.now(),
      exported_by: req.user.id,
      exported_by_name: req.user.name,
      version: '1.0',
      rules: activeRules.map(rule => ({
        name: rule.name,
        version: rule.version,
        description: rule.description,
        priority: rule.priority,
        conditions: rule.conditions,
        steps: rule.steps,
        effective_from: rule.effective_from,
        effective_to: rule.effective_to,
        is_active: rule.is_active,
        created_by: rule.created_by,
        created_at: rule.created_at
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="approval-rules-${Date.now()}.json"`);
    res.json(exportData);

    AuditLog.create({
      user_id: req.user.id,
      action: 'rules_export',
      new_value: { rule_count: activeRules.length },
      ip_address: req.ip
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeImportData(rawData) {
  let data = rawData;
  
  if (data && data.rules && !Array.isArray(data)) {
    data = { rules: data.rules };
  }
  
  if (data && Array.isArray(data.rules)) {
    data.rules = data.rules.map(rule => {
      const { version, is_active, created_at, created_by, id, ...sanitized } = rule;
      return sanitized;
    });
  }
  
  return data;
}

const importRuleSchema = Joi.object({
  rules: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    description: Joi.string().allow(null, ''),
    priority: Joi.number().required(),
    conditions: Joi.object().required(),
    steps: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      type: Joi.string().valid('single', 'countersign', 'any').required(),
      required_roles: Joi.array().items(Joi.string()).required(),
      required_signatures: Joi.number().min(1),
      assigned_to: Joi.string().allow(null)
    })).required(),
    effective_from: Joi.number().allow(null),
    effective_to: Joi.number().allow(null)
  })).required()
});

function validateImportRules(importData) {
  const errors = [];
  const warnings = [];
  const info = [];
  const validRoles = ['applicant', 'department_manager', 'finance', 'legal', 'risk', 'ceo', 'admin'];
  const existingRules = ApprovalRule.findAll();
  const existingNames = existingRules.map(r => r.name);
  const existingPriorities = existingRules.filter(r => r.is_active).map(r => r.priority);
  const allDepartments = Department.findAll().map(d => d.id);
  const allUsers = User.findAll();

  for (let i = 0; i < importData.rules.length; i++) {
    const rule = importData.rules[i];
    const prefix = `规则[${i}] "${rule.name}"`;

    if (!rule.name || rule.name.trim() === '') {
      errors.push(`${prefix}: 规则名称不能为空`);
    }

    if (existingNames.includes(rule.name)) {
      const existingVersions = existingRules.filter(r => r.name === rule.name);
      const activeVersion = existingVersions.find(r => r.is_active);
      if (activeVersion) {
        warnings.push(`${prefix}: 名称已存在，将创建新版本（当前最新版本: v${activeVersion.version}）`);
      } else {
        info.push(`${prefix}: 名称已存在但已停用，将创建新版本并激活`);
      }
    }

    if (existingPriorities.includes(rule.priority)) {
      const conflictingRule = existingRules.find(r => r.is_active && r.priority === rule.priority);
      if (conflictingRule && conflictingRule.name !== rule.name) {
        warnings.push(`${prefix}: 优先级 ${rule.priority} 与现有规则 "${conflictingRule.name}" 冲突，导入后将按版本号排序`);
      }
    }

    const validation = RuleEngine.validateRuleSteps(rule);
    if (!validation.valid) {
      errors.push(`${prefix}: 步骤验证失败: ${validation.errors.join('; ')}`);
    }

    for (const step of rule.steps) {
      for (const role of step.required_roles) {
        if (!validRoles.includes(role)) {
          errors.push(`${prefix}: 步骤 "${step.name}" 引用了无效角色: ${role}`);
        } else {
          const usersWithRole = allUsers.filter(u => u.roles.includes(role));
          if (usersWithRole.length === 0) {
            warnings.push(`${prefix}: 步骤 "${step.name}" 的角色 ${role} 没有配置用户`);
          }
        }
      }
    }

    if (rule.conditions && rule.conditions.type === 'simple' && rule.conditions.field === 'department_id') {
      const deptId = rule.conditions.value;
      if (deptId && !allDepartments.includes(deptId)) {
        warnings.push(`${prefix}: 条件引用了不存在的部门ID: ${deptId}`);
      }
      if (rule.conditions.values) {
        for (const v of rule.conditions.values) {
          if (!allDepartments.includes(v)) {
            warnings.push(`${prefix}: 条件引用了不存在的部门ID: ${v}`);
          }
        }
      }
    }
  }

  const importedNames = importData.rules.map(r => r.name);
  const nameCounts = {};
  for (const name of importedNames) {
    nameCounts[name] = (nameCounts[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(nameCounts)) {
    if (count > 1) {
      errors.push(`导入的规则中存在重名: "${name}" 出现 ${count} 次`);
    }
  }

  return { errors, warnings, info };
}

router.post('/import', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以导入规则' });
    }

    const preview = req.query.preview === 'true';
    const sanitizedBody = sanitizeImportData(req.body);
    const { error, value } = importRuleSchema.validate(sanitizedBody);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const validation = validateImportRules(value);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        errors: validation.errors,
        warnings: validation.warnings,
        info: validation.info
      });
    }

    if (preview) {
      const differences = [];
      const existingRules = ApprovalRule.findAll();

      for (const importedRule of value.rules) {
        const existing = existingRules.find(r => r.name === importedRule.name && r.is_active);
        if (existing) {
          const diff = {
            name: importedRule.name,
            action: 'update',
            current_version: existing.version,
            new_version: existing.version + 1,
            changes: []
          };

          if (JSON.stringify(existing.conditions) !== JSON.stringify(importedRule.conditions)) {
            diff.changes.push('conditions');
          }
          if (JSON.stringify(existing.steps) !== JSON.stringify(importedRule.steps)) {
            diff.changes.push('steps');
          }
          if (existing.priority !== importedRule.priority) {
            diff.changes.push('priority');
          }
          if (existing.description !== importedRule.description) {
            diff.changes.push('description');
          }
          if (diff.changes.length === 0) {
            diff.action = 'no_change';
          }
          differences.push(diff);
        } else {
          differences.push({
            name: importedRule.name,
            action: 'create',
            new_version: 1
          });
        }
      }

      return res.json({
        preview: true,
        can_import: true,
        differences,
        warnings: validation.warnings,
        info: validation.info
      });
    }

    const results = [];
    for (const ruleData of value.rules) {
      const existingRules = ApprovalRule.findAllVersionsByName(ruleData.name);
      const maxVersion = existingRules.length > 0 ? Math.max(...existingRules.map(r => r.version)) : 0;
      const newVersion = maxVersion + 1;

      ApprovalRule.deactivateAllByName(ruleData.name);

      const newRule = ApprovalRule.createVersion({
        ...ruleData,
        version: newVersion,
        created_by: req.user.id
      });

      results.push({
        name: ruleData.name,
        version: newVersion,
        id: newRule.id,
        previous_active_version: existingRules.find(r => r.is_active)?.version || null
      });

      AuditLog.create({
        user_id: req.user.id,
        action: 'rule_import',
        old_value: existingRules.find(r => r.is_active) ? {
          name: ruleData.name,
          version: existingRules.find(r => r.is_active).version,
          description: existingRules.find(r => r.is_active).description,
          conditions: existingRules.find(r => r.is_active).conditions,
          steps: existingRules.find(r => r.is_active).steps,
          priority: existingRules.find(r => r.is_active).priority
        } : null,
        new_value: {
          name: ruleData.name,
          version: newVersion,
          description: ruleData.description,
          conditions: ruleData.conditions,
          steps: ruleData.steps,
          priority: ruleData.priority
        },
        ip_address: req.ip
      });
    }

    const db = require('../database/db');
    db.forceSave();

    res.json({
      success: true,
      imported: results.length,
      results,
      warnings: validation.warnings,
      info: validation.info
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/rollback/:version', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以回滚规则版本' });
    }

    const { name, version } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: '回滚原因不能为空' });
    }

    const targetVersion = ApprovalRule.findByName(name, parseInt(version));
    if (!targetVersion) {
      return res.status(404).json({ error: '指定的规则版本不存在' });
    }

    const currentActive = ApprovalRule.findAllActive().find(r => r.name === name);

    const existingRules = ApprovalRule.findAllVersionsByName(name);
    const maxVersion = existingRules.length > 0 ? Math.max(...existingRules.map(r => r.version)) : 0;
    const newVersion = maxVersion + 1;

    ApprovalRule.deactivateAllByName(name);

    const rolledBackRule = ApprovalRule.createVersion({
      name: targetVersion.name,
      description: targetVersion.description,
      conditions: targetVersion.conditions,
      steps: targetVersion.steps,
      priority: targetVersion.priority,
      effective_from: targetVersion.effective_from,
      effective_to: targetVersion.effective_to,
      version: newVersion,
      created_by: req.user.id
    });

    AuditLog.create({
      user_id: req.user.id,
      action: 'rule_rollback',
      old_value: currentActive ? {
        name: name,
        version: currentActive.version,
        description: currentActive.description,
        conditions: currentActive.conditions,
        steps: currentActive.steps,
        priority: currentActive.priority
      } : null,
      new_value: {
        name: name,
        version: newVersion,
        description: targetVersion.description,
        rolled_back_from: currentActive?.version || null,
        rolled_back_to: targetVersion.version,
        conditions: targetVersion.conditions,
        steps: targetVersion.steps,
        priority: targetVersion.priority,
        reason: reason
      },
      ip_address: req.ip
    });

    const db = require('../database/db');
    db.forceSave();

    res.json({
      success: true,
      message: `规则 "${name}" 已回滚到 v${targetVersion.version}，新版本号 v${newVersion}`,
      rolled_back_from: currentActive?.version || null,
      rolled_back_to: targetVersion.version,
      new_version: newVersion,
      rule: rolledBackRule
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:name/versions', (req, res) => {
  try {
    const { name } = req.params;
    const versions = ApprovalRule.findAllVersionsByName(name);
    
    if (versions.length === 0) {
      return res.status(404).json({ error: '规则不存在' });
    }

    const filteredVersions = versions.map(v => {
      if (req.user.roles.includes('admin')) {
        return v;
      }
      const { created_by, ...publicFields } = v;
      return publicFields;
    });

    res.json(filteredVersions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-name/:name', (req, res) => {
  const { version } = req.query;
  const rule = ApprovalRule.findByName(req.params.name, version ? parseInt(version) : undefined);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  res.json(rule);
});

router.post('/:id/deactivate', (req, res) => {
  if (!req.user.roles.includes('admin')) {
    return res.status(403).json({ error: '只有管理员可以停用规则' });
  }
  
  const rule = ApprovalRule.findById(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  
  ApprovalRule.deactivate(req.params.id);
  res.json({ message: '规则已停用' });
});

router.post('/match', (req, res) => {
  const contract = req.body;
  const matchResult = RuleEngine.findMatchingRule(contract);
  
  if (matchResult) {
    res.json({
      matched: true,
      rule: {
        id: matchResult.rule.id,
        name: matchResult.rule.name,
        version: matchResult.rule.version,
        priority: matchResult.rule.priority,
        steps: matchResult.rule.steps
      },
      hit_reason: matchResult.reason,
      all_matches: matchResult.all_matches.map(m => ({
        rule_id: m.rule.id,
        name: m.rule.name,
        version: m.rule.version,
        reason: m.reason
      }))
    });
  } else {
    res.json({ matched: false, message: '没有匹配的规则' });
  }
});

router.post('/validate', (req, res) => {
  const rule = req.body;
  const result = RuleEngine.validateRuleSteps(rule);
  res.json(result);
});

router.get('/:id', (req, res) => {
  const rule = ApprovalRule.findById(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  res.json(rule);
});

module.exports = router;
