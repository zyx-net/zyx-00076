const express = require('express');
const Joi = require('joi');
const SlaConfig = require('../models/SlaConfig');
const DeadlineAuditLog = require('../models/DeadlineAuditLog');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();
router.use(authMiddleware);

const createSlaSchema = Joi.object({
  name: Joi.string().required(),
  risk_level: Joi.string().valid('low', 'medium', 'high', 'critical').allow(null),
  department_id: Joi.string().allow(null),
  min_amount: Joi.number().min(0).allow(null),
  max_amount: Joi.number().min(0).allow(null),
  step_name: Joi.string().allow(null),
  deadline_hours: Joi.number().min(1).required(),
  first_reminder_hours: Joi.number().min(1).allow(null),
  second_reminder_hours: Joi.number().min(1).allow(null),
  escalation_hours: Joi.number().min(1).allow(null),
  escalation_roles: Joi.array().items(Joi.string()).allow(null),
  priority: Joi.number().default(0),
  is_active: Joi.boolean().default(true)
});

const updateSlaSchema = Joi.object({
  name: Joi.string(),
  risk_level: Joi.string().valid('low', 'medium', 'high', 'critical').allow(null),
  department_id: Joi.string().allow(null),
  min_amount: Joi.number().min(0).allow(null),
  max_amount: Joi.number().min(0).allow(null),
  step_name: Joi.string().allow(null),
  deadline_hours: Joi.number().min(1),
  first_reminder_hours: Joi.number().min(1).allow(null),
  second_reminder_hours: Joi.number().min(1).allow(null),
  escalation_hours: Joi.number().min(1).allow(null),
  escalation_roles: Joi.array().items(Joi.string()).allow(null),
  priority: Joi.number(),
  is_active: Joi.boolean()
});

function requireAdmin(req, res, next) {
  if (!req.user.roles.includes('admin')) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

router.get('/', (req, res) => {
  const { active_only } = req.query;
  const configs = SlaConfig.findAll(active_only === 'true');
  res.json(configs);
});

router.get('/:id', (req, res) => {
  const config = SlaConfig.findById(req.params.id);
  if (!config) {
    return res.status(404).json({ error: 'SLA配置不存在' });
  }
  res.json(config);
});

router.post('/', requireAdmin, (req, res) => {
  try {
    const { error, value } = createSlaSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const validation = SlaConfig.validate(value);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: 'SLA配置验证失败', 
        details: validation.errors 
      });
    }

    const config = SlaConfig.create({
      ...value,
      created_by: req.user.id
    });

    res.status(201).json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  try {
    const existing = SlaConfig.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'SLA配置不存在' });
    }

    const { error, value } = updateSlaSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const config = SlaConfig.update(req.params.id, value);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/deactivate', requireAdmin, (req, res) => {
  try {
    const config = SlaConfig.deactivate(req.params.id);
    if (!config) {
      return res.status(404).json({ error: 'SLA配置不存在' });
    }
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/activate', requireAdmin, (req, res) => {
  try {
    const config = SlaConfig.activate(req.params.id);
    if (!config) {
      return res.status(404).json({ error: 'SLA配置不存在' });
    }
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const existing = SlaConfig.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'SLA配置不存在' });
    }
    SlaConfig.delete(req.params.id);
    res.json({ success: true, message: 'SLA配置已删除' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/validate', (req, res) => {
  const validation = SlaConfig.validate(req.body);
  res.json({
    valid: validation.valid,
    errors: validation.errors
  });
});

router.post('/match', (req, res) => {
  const { contract, step_name } = req.body;
  if (!contract) {
    return res.status(400).json({ error: '缺少合同信息' });
  }

  const matches = SlaConfig.findMatching(contract, step_name);
  const bestMatch = SlaConfig.findBestMatch(contract, step_name);

  res.json({
    matches,
    best_match: bestMatch
  });
});

router.get('/:id/audit-logs', requireAdmin, (req, res) => {
  const logs = DeadlineAuditLog.findAll(100).filter(
    log => log.action === 'created' || log.action === 'recalculated'
  );
  res.json(logs);
});

module.exports = router;
