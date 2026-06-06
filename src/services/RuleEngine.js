const ApprovalRule = require('../models/ApprovalRule');
const User = require('../models/User');

class RuleEngine {
  static evaluateCondition(condition, contract) {
    if (!condition) return true;
    
    const { type, field, operator, value, values, conditions } = condition;
    
    if (type === 'composite') {
      const logic = condition.logic || 'AND';
      const results = conditions.map(c => this.evaluateCondition(c, contract));
      return logic === 'AND' ? results.every(r => r) : results.some(r => r);
    }
    
    if (type === 'simple') {
      const contractValue = contract[field];
      
      switch (operator) {
        case 'equals':
          return contractValue === value;
        case 'not_equals':
          return contractValue !== value;
        case 'in':
          return Array.isArray(values) && values.includes(contractValue);
        case 'not_in':
          return Array.isArray(values) && !values.includes(contractValue);
        case 'greater_than':
          return contractValue > value;
        case 'greater_than_or_equal':
          return contractValue >= value;
        case 'less_than':
          return contractValue < value;
        case 'less_than_or_equal':
          return contractValue <= value;
        case 'between':
          return Array.isArray(values) && values.length === 2 && 
                 contractValue >= values[0] && contractValue <= values[1];
        case 'contains':
          return typeof contractValue === 'string' && contractValue.includes(value);
        default:
          return false;
      }
    }
    
    return false;
  }

  static findMatchingRule(contract) {
    const activeRules = ApprovalRule.findAllActive();
    const matchReasons = [];
    
    for (const rule of activeRules) {
      const reason = this.checkRuleMatch(rule, contract);
      if (reason.matched) {
        matchReasons.push({ rule, reason: reason.details });
        if (!reason.partial) {
          return { rule, reason: reason.details, all_matches: matchReasons };
        }
      }
    }
    
    if (matchReasons.length > 0) {
      return { rule: matchReasons[0].rule, reason: matchReasons[0].reason, all_matches: matchReasons };
    }
    
    return null;
  }

  static checkRuleMatch(rule, contract) {
    const conditions = rule.conditions;
    const details = [];
    let partial = false;
    
    const evaluate = (cond, prefix = '') => {
      if (cond.type === 'composite') {
        const logic = cond.logic || 'AND';
        const subResults = cond.conditions.map(c => evaluate(c, prefix + '  '));
        const allMatched = logic === 'AND' ? subResults.every(r => r.matched) : subResults.some(r => r.matched);
        details.push(`${prefix}${logic}: ${allMatched ? '✓' : '✗'}`);
        if (!allMatched && logic === 'AND') {
          partial = true;
        }
        return { matched: allMatched };
      }
      
      if (cond.type === 'simple') {
        const isMatch = this.evaluateCondition(cond, contract);
        const contractValue = contract[cond.field];
        const desc = `${cond.field} ${cond.operator} ${cond.value || (cond.values ? JSON.stringify(cond.values) : '')}`;
        details.push(`${prefix}${desc}: ${isMatch ? '✓' : '✗'} (actual: ${contractValue})`);
        if (!isMatch) {
          partial = true;
        }
        return { matched: isMatch };
      }
      return { matched: true };
    };
    
    const result = evaluate(conditions);
    
    return { matched: result.matched, partial, details };
  }

  static validateRuleSteps(rule) {
    const errors = [];
    const validRoles = ['applicant', 'department_manager', 'finance', 'legal', 'risk', 'ceo', 'admin'];
    
    for (const step of rule.steps) {
      if (!step.name) {
        errors.push(`步骤缺少名称`);
      }
      if (!step.type || !['single', 'countersign', 'any'].includes(step.type)) {
        errors.push(`步骤 ${step.name} 类型无效，必须是 single/countersign/any`);
      }
      if (!step.required_roles || !Array.isArray(step.required_roles) || step.required_roles.length === 0) {
        errors.push(`步骤 ${step.name} 缺少审批角色`);
      } else {
        for (const role of step.required_roles) {
          if (!validRoles.includes(role)) {
            errors.push(`步骤 ${step.name} 引用了不存在的角色: ${role}`);
          } else {
            const users = User.findByRole(role);
            if (users.length === 0) {
              errors.push(`步骤 ${step.name} 的角色 ${role} 没有配置用户`);
            }
          }
        }
      }
      if (step.type === 'countersign' && (!step.required_signatures || step.required_signatures < 1)) {
        errors.push(`步骤 ${step.name} 是会签步骤，需要指定 required_signatures`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
}

module.exports = RuleEngine;
