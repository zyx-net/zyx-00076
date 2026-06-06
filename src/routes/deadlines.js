const express = require('express');
const Joi = require('joi');
const ApprovalDeadline = require('../models/ApprovalDeadline');
const DeadlineAuditLog = require('../models/DeadlineAuditLog');
const DeadlineService = require('../services/DeadlineService');
const deadlineScheduler = require('../services/DeadlineScheduler');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const pauseSchema = Joi.object({
  reason: Joi.string().required()
});

const reminderSchema = Joi.object({
  reason: Joi.string().allow('')
});

const recalculateSchema = Joi.object({
  reason: Joi.string().allow('')
});

function requireAdmin(req, res, next) {
  if (!req.user.roles.includes('admin')) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

router.get('/my', (req, res) => {
  const { overdue_only, due_soon_hours, status } = req.query;
  
  const filter = {};
  if (overdue_only === 'true') {
    filter.overdue_only = true;
  }
  if (due_soon_hours) {
    filter.due_soon_hours = parseInt(due_soon_hours);
  }
  if (status) {
    filter.status = status;
  }

  const deadlines = DeadlineService.getApproverDeadlines(req.user.id, filter);
  res.json(deadlines);
});

router.get('/my/overdue', (req, res) => {
  const deadlines = DeadlineService.getApproverDeadlines(req.user.id, { overdue_only: true });
  res.json(deadlines);
});

router.get('/my/due-soon', (req, res) => {
  const { hours } = req.query;
  const filter = { due_soon_hours: parseInt(hours) || 24 };
  const deadlines = DeadlineService.getApproverDeadlines(req.user.id, filter);
  res.json(deadlines);
});

router.get('/', requireAdmin, (req, res) => {
  const { status, contract_id, is_overdue } = req.query;
  
  const filter = {};
  if (status) {
    filter.status = status;
  }
  if (contract_id) {
    filter.contract_id = contract_id;
  }
  if (is_overdue === 'true') {
    filter.is_overdue = true;
  }

  const deadlines = DeadlineService.getAllDeadlines(filter);
  res.json(deadlines);
});

router.get('/overdue', requireAdmin, (req, res) => {
  const deadlines = DeadlineService.getAllDeadlines({ is_overdue: true });
  res.json(deadlines);
});

router.get('/:id', (req, res) => {
  const deadline = ApprovalDeadline.findById(req.params.id);
  if (!deadline) {
    return res.status(404).json({ error: '时限记录不存在' });
  }

  if (!req.user.roles.includes('admin')) {
    const hasAccess = deadline.approver_roles.some(role => req.user.roles.includes(role));
    if (!hasAccess) {
      return res.status(403).json({ error: '无权限查看此时限记录' });
    }
  }

  const enriched = DeadlineService._enrichDeadline(deadline);
  res.json(enriched);
});

router.post('/:id/pause', requireAdmin, (req, res) => {
  try {
    const { error, value } = pauseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const deadline = DeadlineService.pauseDeadline(
      req.params.id, 
      req.user.id, 
      value.reason, 
      req.ip
    );
    res.json(deadline);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/resume', requireAdmin, (req, res) => {
  try {
    const deadline = DeadlineService.resumeDeadline(
      req.params.id, 
      req.user.id, 
      req.ip
    );
    res.json(deadline);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/remind', requireAdmin, (req, res) => {
  try {
    const { error, value } = reminderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const result = DeadlineService.sendManualReminder(
      req.params.id, 
      req.user.id, 
      value.reason, 
      req.ip
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/recalculate', requireAdmin, (req, res) => {
  try {
    const { error, value } = recalculateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const result = DeadlineService.recalculateDeadline(
      req.params.id, 
      req.user.id, 
      value.reason, 
      req.ip
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/audit-logs', (req, res) => {
  const deadline = ApprovalDeadline.findById(req.params.id);
  if (!deadline) {
    return res.status(404).json({ error: '时限记录不存在' });
  }

  if (!req.user.roles.includes('admin')) {
    const hasAccess = deadline.approver_roles.some(role => req.user.roles.includes(role));
    if (!hasAccess) {
      return res.status(403).json({ error: '无权限查看此时限记录的审计日志' });
    }
  }

  const logs = DeadlineAuditLog.findByDeadline(req.params.id);
  res.json(logs);
});

router.get('/contract/:contractId', (req, res) => {
  const deadlines = ApprovalDeadline.findByContract(req.params.contractId);
  res.json(deadlines);
});

router.post('/process-reminders', requireAdmin, (req, res) => {
  const results = DeadlineService.processAutomaticReminders();
  res.json({
    success: true,
    results,
    message: `处理完成：首次催办 ${results.first_reminders.length} 条，二次催办 ${results.second_reminders.length} 条，升级 ${results.escalations.length} 条`
  });
});

router.get('/scheduler/status', requireAdmin, (req, res) => {
  res.json(deadlineScheduler.getStatus());
});

router.post('/scheduler/trigger', requireAdmin, (req, res) => {
  const results = deadlineScheduler.runOnce();
  res.json({ success: true, results });
});

module.exports = router;
