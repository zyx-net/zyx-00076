const express = require('express');
const Joi = require('joi');
const ApprovalRule = require('../models/ApprovalRule');
const RuleEngine = require('../services/RuleEngine');
const authMiddleware = require('../middleware/auth');

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

router.get('/:id', (req, res) => {
  const rule = ApprovalRule.findById(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  res.json(rule);
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

module.exports = router;
