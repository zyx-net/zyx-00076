const express = require('express');
const Joi = require('joi');
const Contract = require('../models/Contract');
const Department = require('../models/Department');
const User = require('../models/User');
const ApprovalRule = require('../models/ApprovalRule');
const ApprovalStep = require('../models/ApprovalStep');
const ApprovalAction = require('../models/ApprovalAction');
const AuditLog = require('../models/AuditLog');
const Archive = require('../models/Archive');
const ContractApprovalService = require('../services/ContractApprovalService');
const RuleEngine = require('../services/RuleEngine');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const createContractSchema = Joi.object({
  contract_no: Joi.string().required(),
  title: Joi.string().required(),
  amount: Joi.number().min(0).required(),
  currency: Joi.string().default('CNY'),
  department_id: Joi.string().required(),
  risk_level: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
  content: Joi.string().allow(''),
  attachments: Joi.array().items(Joi.object({
    file_name: Joi.string().required(),
    file_type: Joi.string(),
    file_size: Joi.number(),
    file_path: Joi.string(),
    is_required: Joi.boolean().default(true)
  })).default([])
});

const submitContractSchema = Joi.object({});

const approvalSchema = Joi.object({
  step_id: Joi.string().required(),
  action: Joi.string().valid('approve', 'reject', 'reject_all', 'request_supplement').required(),
  comment: Joi.string().allow(''),
  attachments: Joi.array()
});

const supplementSchema = Joi.object({
  attachments: Joi.array().items(Joi.object({
    file_name: Joi.string().required(),
    file_type: Joi.string(),
    file_size: Joi.number(),
    file_path: Joi.string()
  })).required(),
  comment: Joi.string().allow('')
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = createContractSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const department = Department.findById(value.department_id);
    if (!department) {
      return res.status(400).json({ error: '部门不存在' });
    }
    
    const contract = Contract.create({
      ...value,
      applicant_id: req.user.id
    });
    
    value.attachments.forEach(att => {
      Contract.addAttachment({
        contract_id: contract.id,
        file_name: att.file_name,
        file_type: att.file_type,
        file_size: att.file_size,
        file_path: att.file_path,
        uploaded_by: req.user.id,
        is_required: att.is_required
      });
    });
    
    AuditLog.create({
      contract_id: contract.id,
      user_id: req.user.id,
      action: 'create',
      new_value: { contract_no: value.contract_no, title: value.title },
      ip_address: req.ip
    });
    
    res.status(201).json({
      ...contract,
      attachments: Contract.getAttachments(contract.id)
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '合同编号已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/submit', async (req, res) => {
  try {
    const { error } = submitContractSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const result = await ContractApprovalService.submitContract(
      req.params.id,
      req.user.id,
      req.ip
    );
    
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const { status, applicant_id } = req.query;
  let contracts;
  
  if (status) {
    contracts = Contract.findByStatus(status);
  } else if (applicant_id) {
    contracts = Contract.findByApplicant(applicant_id);
  } else {
    contracts = Contract.findAll();
  }
  
  contracts = contracts.map(c => {
    const applicant = User.findById(c.applicant_id);
    const department = Department.findById(c.department_id);
    return {
      ...c,
      applicant_name: applicant ? applicant.name : null,
      department_name: department ? department.name : null
    };
  });
  
  res.json(contracts);
});

router.get('/:id', (req, res) => {
  const contract = Contract.findById(req.params.id);
  if (!contract) {
    return res.status(404).json({ error: '合同不存在' });
  }
  
  const applicant = User.findById(contract.applicant_id);
  const department = Department.findById(contract.department_id);
  const attachments = Contract.getAttachments(contract.id);
  const steps = ApprovalStep.findByContract(contract.id);
  const actions = ApprovalAction.findByContract(contract.id);
  const rule = contract.rule_id ? ApprovalRule.findById(contract.rule_id) : null;
  
  let hitReason = null;
  if (contract.rule_hit_reason) {
    try {
      hitReason = JSON.parse(contract.rule_hit_reason);
    } catch (e) {
      hitReason = contract.rule_hit_reason;
    }
  }
  
  res.json({
    ...contract,
    applicant_name: applicant ? applicant.name : null,
    department_name: department ? department.name : null,
    attachments,
    steps,
    actions,
    rule: rule ? { id: rule.id, name: rule.name, version: rule.version, conditions: rule.conditions } : null,
    rule_hit_reason: hitReason
  });
});

router.get('/:id/current-step', (req, res) => {
  const currentStep = ContractApprovalService.getCurrentStep(req.params.id);
  if (!currentStep) {
    return res.status(404).json({ error: '合同不存在' });
  }
  res.json(currentStep);
});

router.get('/:id/timeline', (req, res) => {
  const timeline = ContractApprovalService.getContractTimeline(req.params.id);
  if (!timeline) {
    return res.status(404).json({ error: '合同不存在' });
  }
  res.json(timeline);
});

router.get('/:id/comments', (req, res) => {
  const contract = Contract.findById(req.params.id);
  if (!contract) {
    return res.status(404).json({ error: '合同不存在' });
  }
  const actions = ApprovalAction.findByContract(req.params.id);
  res.json(actions.filter(a => a.comment));
});

router.get('/:id/hit-reason', (req, res) => {
  const contract = Contract.findById(req.params.id);
  if (!contract) {
    return res.status(404).json({ error: '合同不存在' });
  }
  
  if (!contract.rule_hit_reason) {
    const matchResult = RuleEngine.findMatchingRule(contract);
    if (matchResult) {
      return res.json({
        rule_id: matchResult.rule.id,
        rule_name: matchResult.rule.name,
        rule_version: matchResult.rule.version,
        hit_reason: matchResult.reason,
        will_apply: true
      });
    }
    return res.json({ hit_reason: null, will_apply: false, message: '没有匹配的规则' });
  }
  
  try {
    res.json({
      rule_id: contract.rule_id,
      rule_version: contract.rule_version,
      hit_reason: JSON.parse(contract.rule_hit_reason)
    });
  } catch (e) {
    res.json({
      rule_id: contract.rule_id,
      rule_version: contract.rule_version,
      hit_reason: contract.rule_hit_reason
    });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const { error, value } = approvalSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const result = await ContractApprovalService.processApproval(
      req.params.id,
      value.step_id,
      req.user.id,
      value.action,
      value.comment,
      value.attachments,
      req.ip
    );
    
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/supplement', async (req, res) => {
  try {
    const { error, value } = supplementSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const result = await ContractApprovalService.submitSupplement(
      req.params.id,
      req.user.id,
      value.attachments,
      value.comment,
      req.ip
    );
    
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const result = await ContractApprovalService.archiveContract(
      req.params.id,
      req.user.id,
      req.ip
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/audit-logs', (req, res) => {
  const contract = Contract.findById(req.params.id);
  if (!contract) {
    return res.status(404).json({ error: '合同不存在' });
  }
  const logs = AuditLog.findByContract(req.params.id);
  
  if (req.user.roles.includes('admin')) {
    res.json(logs);
  } else {
    const filteredLogs = logs.map(log => {
      const { old_value, new_value, ip_address, ...publicFields } = log;
      return publicFields;
    });
    res.json(filteredLogs);
  }
});

module.exports = router;
