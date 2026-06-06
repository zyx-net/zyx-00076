const Contract = require('../models/Contract');
const ApprovalStep = require('../models/ApprovalStep');
const ApprovalAction = require('../models/ApprovalAction');
const ApprovalRule = require('../models/ApprovalRule');
const User = require('../models/User');
const Department = require('../models/Department');
const AuditLog = require('../models/AuditLog');
const Archive = require('../models/Archive');
const RuleEngine = require('./RuleEngine');

const CONTRACT_STATUSES = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVING: 'approving',
  SUPPLEMENT_REQUESTED: 'supplement_requested',
  REJECTED: 'rejected',
  APPROVED: 'approved',
  ARCHIVED: 'archived'
};

const STEP_STATUSES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected'
};

const ACTION_TYPES = {
  APPROVE: 'approve',
  REJECT: 'reject',
  REJECT_ALL: 'reject_all',
  REQUEST_SUPPLEMENT: 'request_supplement',
  SUBMIT_SUPPLEMENT: 'submit_supplement',
  SUBMIT: 'submit',
  ARCHIVE: 'archive',
  WITHDRAW: 'withdraw'
};

class ContractApprovalService {
  static async submitContract(contractId, userId, ipAddress) {
    const contract = Contract.findById(contractId);
    if (!contract) {
      throw new Error('合同不存在');
    }
    
    if (contract.applicant_id !== userId) {
      throw new Error('只有申请人才能提交合同');
    }
    
    if (contract.status !== CONTRACT_STATUSES.DRAFT && 
        contract.status !== CONTRACT_STATUSES.SUPPLEMENT_REQUESTED) {
      throw new Error(`合同状态 [${contract.status}] 不允许提交`);
    }
    
    const attachments = Contract.getAttachments(contractId);
    const requiredAttachments = attachments.filter(a => a.is_required);
    if (requiredAttachments.length === 0) {
      throw new Error('缺少必要附件，请先上传至少一份必要附件');
    }
    
    const matchResult = RuleEngine.findMatchingRule(contract);
    if (!matchResult) {
      throw new Error('没有匹配的审批规则，请检查规则配置');
    }
    
    const { rule, reason } = matchResult;
    const validation = RuleEngine.validateRuleSteps(rule);
    if (!validation.valid) {
      throw new Error(`规则验证失败: ${validation.errors.join('; ')}`);
    }
    
    const oldStatus = contract.status;
    
    ApprovalStep.deleteByContract(contractId);
    
    let firstStepId = null;
    rule.steps.forEach((step, index) => {
      const created = ApprovalStep.create({
        contract_id: contractId,
        step_order: index + 1,
        step_name: step.name,
        step_type: step.type,
        required_roles: step.required_roles,
        required_signatures: step.required_signatures || 1,
        assigned_to: step.assigned_to || null
      });
      if (index === 0) {
        firstStepId = created.id;
      }
    });
    
    ApprovalStep.updateStatus(firstStepId, STEP_STATUSES.IN_PROGRESS);
    
    const updatedContract = Contract.updateStatus(contractId, CONTRACT_STATUSES.APPROVING, {
      rule_id: rule.id,
      rule_version: rule.version,
      rule_hit_reason: JSON.stringify(reason),
      current_step_id: firstStepId
    });
    
    AuditLog.create({
      contract_id: contractId,
      user_id: userId,
      action: ACTION_TYPES.SUBMIT,
      old_value: { status: oldStatus },
      new_value: { 
        status: CONTRACT_STATUSES.APPROVING,
        rule_id: rule.id,
        rule_name: rule.name,
        rule_version: rule.version
      },
      ip_address: ipAddress
    });
    
    const currentStep = ApprovalStep.findById(firstStepId);
    return {
      contract: updatedContract,
      rule: { id: rule.id, name: rule.name, version: rule.version },
      hit_reason: reason,
      current_step: currentStep
    };
  }

  static async processApproval(contractId, stepId, userId, action, comment, attachments, ipAddress) {
    const contract = Contract.findById(contractId);
    if (!contract) {
      throw new Error('合同不存在');
    }
    
    if (contract.status !== CONTRACT_STATUSES.APPROVING && 
        contract.status !== CONTRACT_STATUSES.PENDING_APPROVAL) {
      throw new Error(`合同状态 [${contract.status}] 不允许审批`);
    }
    
    const step = ApprovalStep.findById(stepId);
    if (!step || step.contract_id !== contractId) {
      throw new Error('审批步骤不存在');
    }
    
    if (step.status === STEP_STATUSES.COMPLETED || step.status === STEP_STATUSES.REJECTED) {
      throw new Error(`步骤 [${step.step_name}] 已完成，重复提交`);
    }
    
    if (step.id !== contract.current_step_id) {
      throw new Error(`当前审批步骤不匹配，请刷新后重试`);
    }
    
    if (step.status === STEP_STATUSES.PENDING) {
      throw new Error('步骤尚未激活，请等待上一步完成');
    }
    
    const user = User.findById(userId);
    const hasPermission = step.required_roles.some(role => user.roles.includes(role));
    if (!hasPermission) {
      throw new Error(`越权操作：您没有 [${step.required_roles.join(', ')}] 角色，无法审批此步骤`);
    }
    
    if (userId === contract.applicant_id) {
      throw new Error('申请人不能审批自己提交的合同');
    }
    
    if (ApprovalAction.hasUserApproved(stepId, userId)) {
      throw new Error('您已对此步骤进行过审批，不能重复提交');
    }
    
    const validActions = [ACTION_TYPES.APPROVE, ACTION_TYPES.REJECT, ACTION_TYPES.REJECT_ALL, ACTION_TYPES.REQUEST_SUPPLEMENT];
    if (!validActions.includes(action)) {
      throw new Error(`无效的审批操作: ${action}`);
    }
    
    ApprovalAction.create({
      contract_id: contractId,
      step_id: stepId,
      approver_id: userId,
      action,
      comment,
      attachments
    });
    
    if (action === ACTION_TYPES.REJECT || action === ACTION_TYPES.REJECT_ALL) {
      return this.handleRejection(contractId, stepId, userId, action, ipAddress);
    }
    
    if (action === ACTION_TYPES.REQUEST_SUPPLEMENT) {
      return this.handleSupplementRequest(contractId, stepId, userId, comment, ipAddress);
    }
    
    return this.handleApproval(contractId, stepId, userId, ipAddress);
  }

  static handleApproval(contractId, stepId, userId, ipAddress) {
    const step = ApprovalStep.findById(stepId);
    const approvalCount = ApprovalAction.countApprovalsByStep(stepId);
    
    let stepCompleted = false;
    
    if (step.step_type === 'single') {
      stepCompleted = approvalCount >= 1;
    } else if (step.step_type === 'any') {
      stepCompleted = approvalCount >= 1;
    } else if (step.step_type === 'countersign') {
      stepCompleted = approvalCount >= step.required_signatures;
    }
    
    if (!stepCompleted) {
      AuditLog.create({
        contract_id: contractId,
        user_id: userId,
        action: ACTION_TYPES.APPROVE,
        new_value: {
          step_id: stepId,
          step_name: step.step_name,
          approval_count: approvalCount,
          required: step.required_signatures
        },
        ip_address: ipAddress
      });
      
      return {
        success: true,
        step_completed: false,
        approval_count: approvalCount,
        required: step.required_signatures,
        message: `已批准，当前会签进度 ${approvalCount}/${step.required_signatures}`
      };
    }
    
    ApprovalStep.updateStatus(stepId, STEP_STATUSES.COMPLETED);
    
    const allSteps = ApprovalStep.findByContract(contractId);
    const currentIndex = allSteps.findIndex(s => s.id === stepId);
    const nextStep = allSteps.find((s, i) => i > currentIndex && s.status === STEP_STATUSES.PENDING);
    
    if (nextStep) {
      ApprovalStep.updateStatus(nextStep.id, STEP_STATUSES.IN_PROGRESS);
      Contract.updateStatus(contractId, undefined, { current_step_id: nextStep.id });
      
      AuditLog.create({
        contract_id: contractId,
        user_id: userId,
        action: ACTION_TYPES.APPROVE,
        old_value: { step_id: stepId, step_name: step.step_name },
        new_value: { step_id: nextStep.id, step_name: nextStep.step_name },
        ip_address: ipAddress
      });
      
      return {
        success: true,
        step_completed: true,
        all_completed: false,
        next_step: nextStep,
        message: `步骤 [${step.step_name}] 已完成，进入下一步 [${nextStep.step_name}]`
      };
    }
    
    Contract.updateStatus(contractId, CONTRACT_STATUSES.APPROVED, { current_step_id: null });
    
    AuditLog.create({
      contract_id: contractId,
      user_id: userId,
      action: ACTION_TYPES.APPROVE,
      old_value: { status: CONTRACT_STATUSES.APPROVING },
      new_value: { status: CONTRACT_STATUSES.APPROVED },
      ip_address: ipAddress
    });
    
    return {
      success: true,
      step_completed: true,
      all_completed: true,
      message: '所有审批步骤已完成，合同已通过'
    };
  }

  static handleRejection(contractId, stepId, userId, action, ipAddress) {
    const step = ApprovalStep.findById(stepId);
    ApprovalStep.updateStatus(stepId, STEP_STATUSES.REJECTED);
    
    const contract = Contract.updateStatus(contractId, CONTRACT_STATUSES.REJECTED, { current_step_id: null });
    
    AuditLog.create({
      contract_id: contractId,
      user_id: userId,
      action: action,
      old_value: { status: CONTRACT_STATUSES.APPROVING, step_id: stepId },
      new_value: { status: CONTRACT_STATUSES.REJECTED, step_name: step.step_name },
      ip_address: ipAddress
    });
    
    return {
      success: true,
      rejected: true,
      reject_all: action === ACTION_TYPES.REJECT_ALL,
      message: action === ACTION_TYPES.REJECT_ALL 
        ? `合同已被驳回，需要重新提交` 
        : `步骤 [${step.step_name}] 已驳回，需要修改后重新提交`
    };
  }

  static handleSupplementRequest(contractId, stepId, userId, comment, ipAddress) {
    const step = ApprovalStep.findById(stepId);
    const contract = Contract.updateStatus(contractId, CONTRACT_STATUSES.SUPPLEMENT_REQUESTED, { current_step_id: stepId });
    
    AuditLog.create({
      contract_id: contractId,
      user_id: userId,
      action: ACTION_TYPES.REQUEST_SUPPLEMENT,
      old_value: { status: CONTRACT_STATUSES.APPROVING },
      new_value: { status: CONTRACT_STATUSES.SUPPLEMENT_REQUESTED, step_name: step.step_name, comment },
      ip_address: ipAddress
    });
    
    return {
      success: true,
      supplement_requested: true,
      message: `已要求补件，请通知申请人补充材料。原因: ${comment || '无'}`
    };
  }

  static async submitSupplement(contractId, userId, attachments, comment, ipAddress) {
    const contract = Contract.findById(contractId);
    if (!contract) {
      throw new Error('合同不存在');
    }
    
    if (contract.applicant_id !== userId) {
      throw new Error('只有申请人才能提交补件');
    }
    
    if (contract.status !== CONTRACT_STATUSES.SUPPLEMENT_REQUESTED) {
      throw new Error(`合同状态 [${contract.status}] 不允许提交补件`);
    }
    
    if (!attachments || attachments.length === 0) {
      throw new Error('请上传补件附件');
    }
    
    attachments.forEach(att => {
      Contract.addAttachment({
        contract_id: contractId,
        file_name: att.file_name,
        file_type: att.file_type,
        file_size: att.file_size,
        file_path: att.file_path,
        uploaded_by: userId,
        is_required: false
      });
    });
    
    const step = ApprovalStep.findById(contract.current_step_id);
    ApprovalAction.create({
      contract_id: contractId,
      step_id: contract.current_step_id,
      approver_id: userId,
      action: ACTION_TYPES.SUBMIT_SUPPLEMENT,
      comment,
      attachments: JSON.stringify(attachments.map(a => a.file_name))
    });
    
    Contract.updateStatus(contractId, CONTRACT_STATUSES.APPROVING);
    
    AuditLog.create({
      contract_id: contractId,
      user_id: userId,
      action: ACTION_TYPES.SUBMIT_SUPPLEMENT,
      old_value: { status: CONTRACT_STATUSES.SUPPLEMENT_REQUESTED },
      new_value: { 
        status: CONTRACT_STATUSES.APPROVING,
        attachments_count: attachments.length,
        step_name: step ? step.step_name : null
      },
      ip_address: ipAddress
    });
    
    return {
      success: true,
      message: '补件已提交，继续审批流程'
    };
  }

  static async archiveContract(contractId, userId, ipAddress) {
    const contract = Contract.findById(contractId);
    if (!contract) {
      throw new Error('合同不存在');
    }
    
    if (contract.status !== CONTRACT_STATUSES.APPROVED) {
      throw new Error(`合同状态 [${contract.status}] 不允许归档`);
    }
    
    if (!User.hasRole(userId, 'admin') && userId !== contract.applicant_id) {
      throw new Error('只有管理员或申请人可以归档合同');
    }
    
    const archivedAt = Date.now();
    Contract.updateStatus(contractId, CONTRACT_STATUSES.ARCHIVED, {
      archived_at: archivedAt
    });
    
    const updatedContract = Contract.findById(contractId);
    const attachments = Contract.getAttachments(contractId);
    const actions = ApprovalAction.findByContract(contractId);
    const steps = ApprovalStep.findByContract(contractId);
    const rule = updatedContract.rule_id ? ApprovalRule.findById(updatedContract.rule_id) : null;
    const applicant = User.findById(updatedContract.applicant_id);
    const department = Department.findById(updatedContract.department_id);
    
    const archiveContent = {
      contract: {
        ...updatedContract,
        applicant_name: applicant ? applicant.name : null,
        department_name: department ? department.name : null
      },
      rule: rule ? {
        id: rule.id,
        name: rule.name,
        version: rule.version,
        conditions: rule.conditions,
        steps: rule.steps,
        hit_reason: updatedContract.rule_hit_reason ? JSON.parse(updatedContract.rule_hit_reason) : null
      } : null,
      steps: steps.map(s => ({
        ...s,
        approvals: ApprovalAction.findByStep(s.id)
      })),
      actions,
      attachments,
      audit_logs: AuditLog.findByContract(contractId),
      archived_at: archivedAt,
      archived_by: userId,
      version: '1.0'
    };
    
    const archive = Archive.create({
      contract_id: contractId,
      archived_by: userId,
      content: archiveContent
    });
    
    Contract.updateStatus(contractId, CONTRACT_STATUSES.ARCHIVED, {
      archive_path: archive.file_path
    });
    
    AuditLog.create({
      contract_id: contractId,
      user_id: userId,
      action: ACTION_TYPES.ARCHIVE,
      old_value: { status: CONTRACT_STATUSES.APPROVED },
      new_value: { 
        status: CONTRACT_STATUSES.ARCHIVED,
        archive_no: archive.archive_no,
        file_path: archive.file_path
      },
      ip_address: ipAddress
    });
    
    return {
      success: true,
      archive,
      message: `合同已归档，归档编号: ${archive.archive_no}`
    };
  }

  static getContractTimeline(contractId) {
    const contract = Contract.findById(contractId);
    if (!contract) return null;
    
    const actions = ApprovalAction.findByContract(contractId);
    const steps = ApprovalStep.findByContract(contractId);
    const audits = AuditLog.findByContract(contractId);
    
    const timeline = [];
    
    timeline.push({
      time: contract.created_at,
      type: 'created',
      title: '合同创建',
      description: `合同编号: ${contract.contract_no}`,
      user_id: contract.applicant_id
    });
    
    steps.forEach(step => {
      if (step.started_at) {
        timeline.push({
          time: step.started_at,
          type: 'step_started',
          title: `开始审批: ${step.step_name}`,
          description: `步骤类型: ${step.step_type}, 需要角色: ${step.required_roles.join(', ')}`,
          step_id: step.id
        });
      }
      if (step.completed_at) {
        timeline.push({
          time: step.completed_at,
          type: step.status === 'completed' ? 'step_completed' : 'step_rejected',
          title: step.status === 'completed' ? `步骤完成: ${step.step_name}` : `步骤驳回: ${step.step_name}`,
          step_id: step.id
        });
      }
    });
    
    actions.forEach(action => {
      const actionLabels = {
        'approve': '批准',
        'reject': '驳回',
        'reject_all': '彻底驳回',
        'request_supplement': '要求补件',
        'submit_supplement': '提交补件'
      };
      timeline.push({
        time: action.created_at,
        type: `action_${action.action}`,
        title: `${action.approver_name} ${actionLabels[action.action] || action.action}`,
        description: action.comment,
        user_id: action.approver_id,
        user_name: action.approver_name,
        step_id: action.step_id,
        action_id: action.id
      });
    });
    
    audits.forEach(audit => {
      if (audit.action === 'submit') {
        timeline.push({
          time: audit.created_at,
          type: 'submitted',
          title: '提交审批',
          description: audit.new_value ? `规则: ${audit.new_value.rule_name} v${audit.new_value.rule_version}` : '',
          user_id: audit.user_id,
          user_name: audit.user_name
        });
      }
      if (audit.action === 'archive') {
        timeline.push({
          time: audit.created_at,
          type: 'archived',
          title: '合同归档',
          description: audit.new_value ? `归档编号: ${audit.new_value.archive_no}` : '',
          user_id: audit.user_id,
          user_name: audit.user_name
        });
      }
    });
    
    if (contract.archived_at) {
      timeline.push({
        time: contract.archived_at,
        type: 'archived',
        title: '归档完成',
        description: `归档路径: ${contract.archive_path}`
      });
    }
    
    return timeline.sort((a, b) => a.time - b.time);
  }

  static getTodoList(userId) {
    const user = User.findById(userId);
    if (!user) return [];
    
    const allPendingSteps = [];
    const seenStepIds = new Set();
    
    for (const role of user.roles) {
      const steps = ApprovalStep.findByRole(role);
      for (const step of steps) {
        if (!seenStepIds.has(step.id)) {
          seenStepIds.add(step.id);
          allPendingSteps.push(step);
        }
      }
    }
    
    const todos = [];
    
    for (const step of allPendingSteps) {
      if (ApprovalAction.hasUserApproved(step.id, userId)) {
        continue;
      }
      
      const contract = Contract.findById(step.contract_id);
      if (!contract || contract.status !== CONTRACT_STATUSES.APPROVING) {
        continue;
      }
      
      const applicant = User.findById(contract.applicant_id);
      const department = Department.findById(contract.department_id);
      
      todos.push({
        contract_id: contract.id,
        contract_no: contract.contract_no,
        contract_title: contract.title,
        amount: contract.amount,
        currency: contract.currency,
        department: department ? department.name : null,
        risk_level: contract.risk_level,
        applicant_name: applicant ? applicant.name : null,
        step_id: step.id,
        step_name: step.step_name,
        step_type: step.step_type,
        required_roles: step.required_roles,
        current_approval_count: ApprovalAction.countApprovalsByStep(step.id),
        required_signatures: step.required_signatures,
        created_at: contract.created_at,
        step_started_at: step.started_at
      });
    }
    
    return todos.sort((a, b) => a.step_started_at - b.step_started_at);
  }

  static getCurrentStep(contractId) {
    const contract = Contract.findById(contractId);
    if (!contract) return null;
    
    if (!contract.current_step_id) {
      return {
        status: contract.status,
        is_completed: [CONTRACT_STATUSES.APPROVED, CONTRACT_STATUSES.ARCHIVED, CONTRACT_STATUSES.REJECTED].includes(contract.status),
        message: this.getStatusMessage(contract.status)
      };
    }
    
    const step = ApprovalStep.findById(contract.current_step_id);
    const actions = ApprovalAction.findByStep(step.id);
    const approvalCount = ApprovalAction.countApprovalsByStep(step.id);
    
    return {
      status: contract.status,
      step: {
        id: step.id,
        name: step.step_name,
        type: step.step_type,
        status: step.status,
        required_roles: step.required_roles,
        required_signatures: step.required_signatures,
        current_approval_count: approvalCount,
        started_at: step.started_at
      },
      actions: actions.map(a => ({
        id: a.id,
        approver: a.approver_name,
        action: a.action,
        comment: a.comment,
        time: a.created_at
      })),
      is_completed: false,
      message: `当前步骤: ${step.step_name}`
    };
  }

  static getStatusMessage(status) {
    const messages = {
      [CONTRACT_STATUSES.DRAFT]: '草稿状态，可编辑后提交',
      [CONTRACT_STATUSES.PENDING_APPROVAL]: '待提交审批',
      [CONTRACT_STATUSES.APPROVING]: '审批中',
      [CONTRACT_STATUSES.SUPPLEMENT_REQUESTED]: '需要补件',
      [CONTRACT_STATUSES.REJECTED]: '已驳回',
      [CONTRACT_STATUSES.APPROVED]: '已批准，可归档',
      [CONTRACT_STATUSES.ARCHIVED]: '已归档'
    };
    return messages[status] || status;
  }
}

module.exports = ContractApprovalService;
