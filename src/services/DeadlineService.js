const SlaConfig = require('../models/SlaConfig');
const ApprovalDeadline = require('../models/ApprovalDeadline');
const DeadlineAuditLog = require('../models/DeadlineAuditLog');
const Contract = require('../models/Contract');
const ApprovalStep = require('../models/ApprovalStep');
const User = require('../models/User');
const db = require('../database/db');

const HOURS_TO_MS = 60 * 60 * 1000;
const DEFAULT_DEADLINE_HOURS = 24;

const DIGESTING_ACTIONS = [
  DeadlineAuditLog.ACTION_TYPES.PAUSED,
  DeadlineAuditLog.ACTION_TYPES.RESUMED,
  DeadlineAuditLog.ACTION_TYPES.COMPLETED,
  DeadlineAuditLog.ACTION_TYPES.CLOSED,
  DeadlineAuditLog.ACTION_TYPES.RECALCULATED
];

class DeadlineService {
  static calculateDeadline(contract, step, startedAt = Date.now()) {
    const slaConfig = SlaConfig.findBestMatch(contract, step.step_name);
    
    if (!slaConfig) {
      return {
        sla_config_id: null,
        deadline_hours: DEFAULT_DEADLINE_HOURS,
        deadline_at: startedAt + DEFAULT_DEADLINE_HOURS * HOURS_TO_MS,
        first_reminder_at: null,
        second_reminder_at: null,
        escalation_at: null,
        escalation_roles: null
      };
    }

    const deadlineAt = startedAt + slaConfig.deadline_hours * HOURS_TO_MS;
    const firstReminderAt = slaConfig.first_reminder_hours 
      ? startedAt + slaConfig.first_reminder_hours * HOURS_TO_MS 
      : null;
    const secondReminderAt = slaConfig.second_reminder_hours 
      ? startedAt + slaConfig.second_reminder_hours * HOURS_TO_MS 
      : null;
    const escalationAt = slaConfig.escalation_hours 
      ? startedAt + slaConfig.escalation_hours * HOURS_TO_MS 
      : null;

    return {
      sla_config_id: slaConfig.id,
      deadline_hours: slaConfig.deadline_hours,
      deadline_at: deadlineAt,
      first_reminder_at: firstReminderAt,
      second_reminder_at: secondReminderAt,
      escalation_at: escalationAt,
      escalation_roles: slaConfig.escalation_roles
    };
  }

  static createDeadlineForStep(contractId, stepId) {
    const contract = Contract.findById(contractId);
    if (!contract) {
      throw new Error('合同不存在');
    }

    const step = ApprovalStep.findById(stepId);
    if (!step) {
      throw new Error('审批步骤不存在');
    }

    const existingActive = ApprovalDeadline.findActiveByStep(stepId);
    if (existingActive.length > 0) {
      throw new Error('该步骤已有活跃的时限记录');
    }

    const startedAt = step.started_at || Date.now();
    const calculation = this.calculateDeadline(contract, step, startedAt);

    const deadline = ApprovalDeadline.create({
      contract_id: contractId,
      step_id: stepId,
      step_name: step.step_name,
      sla_config_id: calculation.sla_config_id,
      approver_roles: step.required_roles,
      started_at: startedAt,
      deadline_hours: calculation.deadline_hours,
      deadline_at: calculation.deadline_at,
      first_reminder_at: calculation.first_reminder_at,
      second_reminder_at: calculation.second_reminder_at,
      escalation_at: calculation.escalation_at
    });

    DeadlineAuditLog.create({
      deadline_id: deadline.id,
      contract_id: contractId,
      step_id: stepId,
      action: DeadlineAuditLog.ACTION_TYPES.CREATED,
      reason: '合同审批步骤启动',
      new_status: ApprovalDeadline.STATUSES.ACTIVE,
      new_value: {
        deadline_at: calculation.deadline_at,
        sla_config_id: calculation.sla_config_id
      }
    });

    db.forceSave();
    return deadline;
  }

  static closeDeadline(deadlineId, reason, userId = null, ipAddress = null) {
    const deadline = ApprovalDeadline.findById(deadlineId);
    if (!deadline) {
      throw new Error('时限记录不存在');
    }

    const oldStatus = deadline.status;
    const closed = ApprovalDeadline.close(deadlineId, reason);

    DeadlineAuditLog.create({
      deadline_id: deadlineId,
      contract_id: deadline.contract_id,
      step_id: deadline.step_id,
      user_id: userId,
      action: DeadlineAuditLog.ACTION_TYPES.CLOSED,
      reason: reason,
      old_status: oldStatus,
      new_status: ApprovalDeadline.STATUSES.CLOSED,
      ip_address: ipAddress
    });

    db.forceSave();
    return closed;
  }

  static completeDeadline(deadlineId, userId = null, ipAddress = null) {
    const deadline = ApprovalDeadline.findById(deadlineId);
    if (!deadline) {
      throw new Error('时限记录不存在');
    }

    const oldStatus = deadline.status;
    const completed = ApprovalDeadline.complete(deadlineId);

    DeadlineAuditLog.create({
      deadline_id: deadlineId,
      contract_id: deadline.contract_id,
      step_id: deadline.step_id,
      user_id: userId,
      action: DeadlineAuditLog.ACTION_TYPES.COMPLETED,
      reason: '审批步骤完成',
      old_status: oldStatus,
      new_status: ApprovalDeadline.STATUSES.COMPLETED,
      ip_address: ipAddress
    });

    db.forceSave();
    return completed;
  }

  static pauseDeadline(deadlineId, userId, reason, ipAddress = null) {
    const deadline = ApprovalDeadline.findById(deadlineId);
    if (!deadline) {
      throw new Error('时限记录不存在');
    }

    const oldStatus = deadline.status;
    const paused = ApprovalDeadline.pause(deadlineId, userId, reason);

    DeadlineAuditLog.create({
      deadline_id: deadlineId,
      contract_id: deadline.contract_id,
      step_id: deadline.step_id,
      user_id: userId,
      action: DeadlineAuditLog.ACTION_TYPES.PAUSED,
      reason: reason,
      old_status: oldStatus,
      new_status: ApprovalDeadline.STATUSES.PAUSED,
      ip_address: ipAddress
    });

    db.forceSave();
    return paused;
  }

  static resumeDeadline(deadlineId, userId, ipAddress = null) {
    const deadline = ApprovalDeadline.findById(deadlineId);
    if (!deadline) {
      throw new Error('时限记录不存在');
    }

    const oldStatus = deadline.status;
    const resumed = ApprovalDeadline.resume(deadlineId, userId);

    DeadlineAuditLog.create({
      deadline_id: deadlineId,
      contract_id: deadline.contract_id,
      step_id: deadline.step_id,
      user_id: userId,
      action: DeadlineAuditLog.ACTION_TYPES.RESUMED,
      old_status: oldStatus,
      new_status: ApprovalDeadline.STATUSES.ACTIVE,
      ip_address: ipAddress
    });

    db.forceSave();
    return resumed;
  }

  static hasUndigestedManualReminder(deadlineId) {
    const logs = DeadlineAuditLog.findByDeadline(deadlineId);
    if (logs.length === 0) {
      return false;
    }

    let lastManualReminderIndex = -1;
    for (let i = 0; i < logs.length; i++) {
      if (logs[i].action === DeadlineAuditLog.ACTION_TYPES.MANUAL_REMINDER) {
        lastManualReminderIndex = i;
        break;
      }
    }

    if (lastManualReminderIndex === -1) {
      return false;
    }

    for (let i = 0; i < lastManualReminderIndex; i++) {
      if (DIGESTING_ACTIONS.includes(logs[i].action)) {
        return false;
      }
    }

    return true;
  }

  static sendManualReminder(deadlineId, userId, reason, ipAddress = null) {
    const deadline = ApprovalDeadline.findById(deadlineId);
    if (!deadline) {
      throw new Error('时限记录不存在');
    }

    if (deadline.status !== ApprovalDeadline.STATUSES.ACTIVE) {
      throw new Error(`当前状态 [${deadline.status}] 不允许催办`);
    }

    if (this.hasUndigestedManualReminder(deadlineId)) {
      throw new Error('该时限已有未消化的手动催办，请先处理后再催办');
    }

    DeadlineAuditLog.create({
      deadline_id: deadlineId,
      contract_id: deadline.contract_id,
      step_id: deadline.step_id,
      user_id: userId,
      action: DeadlineAuditLog.ACTION_TYPES.MANUAL_REMINDER,
      reason: reason,
      old_status: deadline.status,
      new_status: deadline.status,
      ip_address: ipAddress
    });

    db.forceSave();
    return {
      success: true,
      message: '催办通知已发送',
      deadline: deadline
    };
  }

  static processAutomaticReminders(now = Date.now()) {
    const results = {
      first_reminders: [],
      second_reminders: [],
      escalations: []
    };

    const forFirst = ApprovalDeadline.findForFirstReminder(now);
    for (const deadline of forFirst) {
      if (deadline.status !== ApprovalDeadline.STATUSES.ACTIVE) continue;

      ApprovalDeadline.markFirstReminderSent(deadline.id);
      DeadlineAuditLog.create({
        deadline_id: deadline.id,
        contract_id: deadline.contract_id,
        step_id: deadline.step_id,
        action: DeadlineAuditLog.ACTION_TYPES.FIRST_REMINDER,
        reason: '自动催办 - 首次提醒',
        old_status: deadline.status,
        new_status: deadline.status,
        old_value: { first_reminder_sent: false },
        new_value: { first_reminder_sent: true }
      });
      results.first_reminders.push(deadline.id);
    }

    const forSecond = ApprovalDeadline.findForSecondReminder(now);
    for (const deadline of forSecond) {
      if (deadline.status !== ApprovalDeadline.STATUSES.ACTIVE) continue;

      ApprovalDeadline.markSecondReminderSent(deadline.id);
      DeadlineAuditLog.create({
        deadline_id: deadline.id,
        contract_id: deadline.contract_id,
        step_id: deadline.step_id,
        action: DeadlineAuditLog.ACTION_TYPES.SECOND_REMINDER,
        reason: '自动催办 - 二次提醒',
        old_status: deadline.status,
        new_status: deadline.status,
        old_value: { second_reminder_sent: false },
        new_value: { second_reminder_sent: true }
      });
      results.second_reminders.push(deadline.id);
    }

    const forEscalation = ApprovalDeadline.findForEscalation(now);
    for (const deadline of forEscalation) {
      if (deadline.status !== ApprovalDeadline.STATUSES.ACTIVE) continue;

      ApprovalDeadline.markEscalationSent(deadline.id);
      DeadlineAuditLog.create({
        deadline_id: deadline.id,
        contract_id: deadline.contract_id,
        step_id: deadline.step_id,
        action: DeadlineAuditLog.ACTION_TYPES.ESCALATION,
        reason: '自动升级 - 超时未处理',
        old_status: deadline.status,
        new_status: deadline.status,
        old_value: { escalation_sent: false },
        new_value: { escalation_sent: true }
      });
      results.escalations.push(deadline.id);
    }

    if (results.first_reminders.length > 0 || results.second_reminders.length > 0 || results.escalations.length > 0) {
      db.forceSave();
    }

    return results;
  }

  static getApproverDeadlines(userId, filter = {}) {
    const user = User.findById(userId);
    if (!user) {
      return [];
    }

    const deadlines = ApprovalDeadline.findByApproverRole(user.roles);
    
    let filtered = deadlines;
    if (filter.overdue_only) {
      filtered = filtered.filter(d => d.is_overdue);
    }
    if (filter.due_soon_hours) {
      const threshold = Date.now() + filter.due_soon_hours * HOURS_TO_MS;
      filtered = filtered.filter(d => d.deadline_at < threshold);
    }
    if (filter.status) {
      filtered = filtered.filter(d => d.status === filter.status);
    }

    return filtered.map(d => this._enrichDeadline(d));
  }

  static getAllDeadlines(filter = {}) {
    const deadlines = ApprovalDeadline.findAll(filter);
    return deadlines.map(d => this._enrichDeadline(d));
  }

  static recalculateDeadline(deadlineId, userId = null, reason = null, ipAddress = null) {
    const oldDeadline = ApprovalDeadline.findById(deadlineId);
    if (!oldDeadline) {
      throw new Error('时限记录不存在');
    }

    const contract = Contract.findById(oldDeadline.contract_id);
    const step = ApprovalStep.findById(oldDeadline.step_id);

    if (!contract || !step) {
      throw new Error('合同或步骤不存在');
    }

    const oldStatus = oldDeadline.status;
    ApprovalDeadline.close(deadlineId, ApprovalDeadline.CLOSE_REASONS.REFLOW);
    
    const closedOldDeadline = ApprovalDeadline.findById(deadlineId);

    const calculation = this.calculateDeadline(contract, step, oldDeadline.started_at);

    const newDeadline = ApprovalDeadline.create({
      contract_id: oldDeadline.contract_id,
      step_id: oldDeadline.step_id,
      step_name: oldDeadline.step_name,
      sla_config_id: calculation.sla_config_id,
      approver_roles: oldDeadline.approver_roles,
      started_at: oldDeadline.started_at,
      deadline_hours: calculation.deadline_hours,
      deadline_at: calculation.deadline_at,
      first_reminder_at: calculation.first_reminder_at,
      second_reminder_at: calculation.second_reminder_at,
      escalation_at: calculation.escalation_at
    });

    DeadlineAuditLog.create({
      deadline_id: newDeadline.id,
      contract_id: oldDeadline.contract_id,
      step_id: oldDeadline.step_id,
      user_id: userId,
      action: DeadlineAuditLog.ACTION_TYPES.RECALCULATED,
      reason: reason || '重新计算时限',
      old_status: oldStatus,
      new_status: ApprovalDeadline.STATUSES.ACTIVE,
      old_value: {
        deadline_id: deadlineId,
        deadline_at: oldDeadline.deadline_at
      },
      new_value: {
        deadline_id: newDeadline.id,
        deadline_at: calculation.deadline_at
      },
      ip_address: ipAddress
    });

    db.forceSave();
    return {
      old_deadline: closedOldDeadline,
      new_deadline: newDeadline
    };
  }

  static handleStepStarted(contractId, stepId) {
    try {
      return this.createDeadlineForStep(contractId, stepId);
    } catch (e) {
      if (e.message.includes('已有活跃的时限记录')) {
        return null;
      }
      throw e;
    }
  }

  static handleStepCompleted(contractId, stepId, userId = null, ipAddress = null) {
    const active = ApprovalDeadline.findActiveByStep(stepId);
    const results = [];
    for (const deadline of active) {
      results.push(this.completeDeadline(deadline.id, userId, ipAddress));
    }
    return results;
  }

  static handleSupplementRequested(contractId, userId = null, ipAddress = null) {
    return ApprovalDeadline.closeActiveByContract(
      contractId, 
      ApprovalDeadline.CLOSE_REASONS.SUPPLEMENT,
      userId,
      ipAddress
    );
  }

  static handleRejected(contractId, rejectAll = false, userId = null, ipAddress = null) {
    const reason = rejectAll 
      ? ApprovalDeadline.CLOSE_REASONS.REJECT_ALL 
      : ApprovalDeadline.CLOSE_REASONS.REJECTED;
    return ApprovalDeadline.closeActiveByContract(contractId, reason, userId, ipAddress);
  }

  static handleArchived(contractId, userId = null, ipAddress = null) {
    return ApprovalDeadline.closeActiveByContract(
      contractId, 
      ApprovalDeadline.CLOSE_REASONS.ARCHIVED,
      userId,
      ipAddress
    );
  }

  static handleReflow(contractId, stepId, userId = null, ipAddress = null) {
    const closed = ApprovalDeadline.closeActiveByContract(
      contractId, 
      ApprovalDeadline.CLOSE_REASONS.REFLOW,
      userId,
      ipAddress
    );

    const newDeadline = this.createDeadlineForStep(contractId, stepId);
    return { closed, new_deadline: newDeadline };
  }

  static _enrichDeadline(deadline) {
    const contract = Contract.findById(deadline.contract_id);
    const applicant = contract ? User.findById(contract.applicant_id) : null;
    
    return {
      ...deadline,
      contract_no: contract ? contract.contract_no : null,
      contract_title: contract ? contract.title : null,
      contract_amount: contract ? contract.amount : null,
      contract_risk_level: contract ? contract.risk_level : null,
      applicant_name: applicant ? applicant.name : null,
      deadline_audit_logs: DeadlineAuditLog.findByDeadline(deadline.id)
    };
  }
}

module.exports = DeadlineService;
