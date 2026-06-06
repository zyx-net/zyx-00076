const express = require('express');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const ApprovalRule = require('../models/ApprovalRule');
const RuleEngine = require('../services/RuleEngine');
const { calculateImportSummary } = require('../services/RuleImportSummary');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Department = require('../models/Department');
const AuditLog = require('../models/AuditLog');
const ImportBatch = require('../models/ImportBatch');
const config = require('../config');

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

    const importSummary = calculateImportSummary(value, {
      includeNoChangeInAudit: config.ruleImport.auditNoChange
    });

    const hasValidationErrors = importSummary.rules.some(r =>
      r.change_type === 'validation_failed' || r.change_type === 'duplicate_name'
    );

    if (hasValidationErrors) {
      return res.status(400).json({
        preview: preview,
        can_import: false,
        summary: importSummary.summary,
        total: importSummary.total,
        rules: importSummary.rules,
        errors: importSummary.errors,
        warnings: importSummary.warnings
      });
    }

    if (preview) {
      return res.json({
        preview: true,
        can_import: true,
        summary: importSummary.summary,
        total: importSummary.total,
        rules: importSummary.rules,
        warnings: importSummary.warnings
      });
    }

    const batchId = uuidv4();
    const results = [];
    const db = require('../database/db');

    for (const ruleSummary of importSummary.rules) {
      const ruleData = value.rules[ruleSummary.index];

      if (ruleSummary.change_type === 'no_change' && !config.ruleImport.auditNoChange) {
        results.push({
          name: ruleData.name,
          version: ruleSummary.current_version,
          change_type: ruleSummary.change_type,
          skipped: true,
          reason: '无变化，未创建新版本'
        });
        continue;
      }

      const existingRules = ApprovalRule.findAllVersionsByName(ruleData.name);
      const previousActive = existingRules.find(r => r.is_active);

      ApprovalRule.deactivateAllByName(ruleData.name);

      const newRule = ApprovalRule.createVersion({
        ...ruleData,
        version: ruleSummary.new_version,
        created_by: req.user.id
      });

      results.push({
        name: ruleData.name,
        version: ruleSummary.new_version,
        id: newRule.id,
        change_type: ruleSummary.change_type,
        previous_active_version: previousActive?.version || null,
        field_diff: ruleSummary.field_diff
      });

      if (ruleSummary.should_audit) {
        AuditLog.create({
          user_id: req.user.id,
          action: 'rule_import',
          old_value: previousActive ? {
            name: ruleData.name,
            version: previousActive.version,
            description: previousActive.description,
            conditions: previousActive.conditions,
            steps: previousActive.steps,
            priority: previousActive.priority
          } : null,
          new_value: {
            name: ruleData.name,
            version: ruleSummary.new_version,
            description: ruleData.description,
            conditions: ruleData.conditions,
            steps: ruleData.steps,
            priority: ruleData.priority,
            change_type: ruleSummary.change_type,
            batch_id: batchId,
            field_diff: ruleSummary.field_diff
          },
          ip_address: req.ip
        });
      }
    }

    db.forceSave();

    ImportBatch.create({
      id: batchId,
      user_id: req.user.id,
      summary: importSummary.summary,
      rules_summary: importSummary.rules,
      results: results,
      config_switches: {
        auditNoChange: config.ruleImport.auditNoChange
      }
    });

    db.forceSave();

    res.json({
      success: true,
      batch_id: batchId,
      imported: results.filter(r => !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      total: results.length,
      summary: importSummary.summary,
      rules: importSummary.rules,
      results,
      warnings: importSummary.warnings
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

router.get('/batches', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以查看导入批次' });
    }

    const { user_id, undo_status, limit } = req.query;
    const options = {};
    if (user_id) options.user_id = user_id;
    if (undo_status) options.undo_status = undo_status;
    if (limit) options.limit = parseInt(limit);

    const batches = ImportBatch.findAll(options);
    res.json(batches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/batches/:id', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以查看导入批次详情' });
    }

    const batch = ImportBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ error: '批次不存在' });
    }
    res.json(batch);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function undoImportBatch(batchId, userId, ipAddress) {
  const batch = ImportBatch.findById(batchId);
  if (!batch) {
    return { success: false, error: '批次不存在', status: 404 };
  }

  if (batch.undo_status !== 'none') {
    return { success: false, error: '该批次已被撤销，无法重复操作', status: 400 };
  }

  const db = require('../database/db');
  const undoResults = [];

  for (const ruleSummary of batch.rules_summary) {
    const ruleName = ruleSummary.name;
    const changeType = ruleSummary.change_type;
    const newVersion = ruleSummary.new_version;
    const previousVersion = ruleSummary.current_version;

    const allVersions = ApprovalRule.findAllVersionsByName(ruleName);
    const currentActive = allVersions.find(r => r.is_active);

    if (changeType === 'create' || changeType === 'priority_conflict') {
      const createdRule = allVersions.find(r => r.version === newVersion);
      if (createdRule && createdRule.is_active) {
        ApprovalRule.deactivate(createdRule.id);
        undoResults.push({
          name: ruleName,
          change_type: changeType,
          undo_action: 'deactivated',
          version: newVersion,
          message: `新增规则已停用`
        });

        AuditLog.create({
          user_id: userId,
          action: 'rule_batch_undo',
          old_value: {
            name: ruleName,
            version: newVersion,
            is_active: 1,
            change_type: changeType
          },
          new_value: {
            name: ruleName,
            version: newVersion,
            is_active: 0,
            undo_action: 'deactivated',
            batch_id: batchId
          },
          ip_address: ipAddress
        });
      } else if (createdRule && !createdRule.is_active) {
        undoResults.push({
          name: ruleName,
          change_type: changeType,
          undo_action: 'skipped',
          version: newVersion,
          reason: '规则已处于非活跃状态，跳过'
        });
      } else {
        undoResults.push({
          name: ruleName,
          change_type: changeType,
          undo_action: 'skipped',
          version: newVersion,
          reason: '未找到对应版本规则，跳过'
        });
      }
    } else if (changeType === 'update') {
      const currentVersionRule = allVersions.find(r => r.version === newVersion);
      const previousVersionRule = allVersions.find(r => r.version === previousVersion);

      if (currentVersionRule && currentVersionRule.is_active && previousVersionRule) {
        ApprovalRule.deactivate(currentVersionRule.id);

        const existingMaxVersion = Math.max(...allVersions.map(r => r.version));
        const newReactivatedVersion = existingMaxVersion + 1;

        const reactivatedRule = ApprovalRule.createVersion({
          name: previousVersionRule.name,
          description: previousVersionRule.description,
          conditions: previousVersionRule.conditions,
          steps: previousVersionRule.steps,
          priority: previousVersionRule.priority,
          effective_from: previousVersionRule.effective_from,
          effective_to: previousVersionRule.effective_to,
          version: newReactivatedVersion,
          created_by: userId
        });

        undoResults.push({
          name: ruleName,
          change_type: changeType,
          undo_action: 'reverted',
          deactivated_version: newVersion,
          reactivated_version: newReactivatedVersion,
          based_on_version: previousVersion,
          message: `已切回 v${previousVersion} 内容并创建新版本 v${newReactivatedVersion}`
        });

        AuditLog.create({
          user_id: userId,
          action: 'rule_batch_undo',
          old_value: {
            name: ruleName,
            active_version: newVersion,
            change_type: changeType
          },
          new_value: {
            name: ruleName,
            deactivated_version: newVersion,
            new_active_version: newReactivatedVersion,
            based_on_version: previousVersion,
            undo_action: 'reverted',
            batch_id: batchId
          },
          ip_address: ipAddress
        });
      } else if (!currentVersionRule || !currentVersionRule.is_active) {
        undoResults.push({
          name: ruleName,
          change_type: changeType,
          undo_action: 'skipped',
          version: newVersion,
          reason: '当前版本已非活跃，跳过'
        });
      } else if (!previousVersionRule) {
        undoResults.push({
          name: ruleName,
          change_type: changeType,
          undo_action: 'skipped',
          version: newVersion,
          reason: '未找到上一版本，无法回退，跳过'
        });
      }
    } else if (changeType === 'no_change') {
      undoResults.push({
        name: ruleName,
        change_type: changeType,
        undo_action: 'skipped',
        reason: '无变化规则，跳过'
      });
    } else if (changeType === 'validation_failed' || changeType === 'duplicate_name') {
      undoResults.push({
        name: ruleName,
        change_type: changeType,
        undo_action: 'skipped',
        reason: '校验失败或重名规则，未实际导入，跳过'
      });
    } else {
      undoResults.push({
        name: ruleName,
        change_type: changeType,
        undo_action: 'skipped',
        reason: `未知变更类型 ${changeType}，跳过`
      });
    }
  }

  db.forceSave();

  ImportBatch.updateUndoStatus(batchId, {
    undo_status: 'completed',
    undo_by: userId,
    undo_results: undoResults
  });

  db.forceSave();

  return {
    success: true,
    batch_id: batchId,
    undo_results: undoResults,
    summary: {
      deactivated: undoResults.filter(r => r.undo_action === 'deactivated').length,
      reverted: undoResults.filter(r => r.undo_action === 'reverted').length,
      skipped: undoResults.filter(r => r.undo_action === 'skipped').length,
      total: undoResults.length
    }
  };
}

router.post('/batches/:id/undo', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以撤销导入批次' });
    }

    const result = undoImportBatch(req.params.id, req.user.id, req.ip);

    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const rule = ApprovalRule.findById(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  res.json(rule);
});

module.exports = router;
