const ApprovalRule = require('../models/ApprovalRule');
const RuleEngine = require('./RuleEngine');
const User = require('../models/User');
const Department = require('../models/Department');

const CHANGE_TYPES = {
  CREATE: 'create',
  UPDATE: 'update',
  NO_CHANGE: 'no_change',
  PRIORITY_CONFLICT: 'priority_conflict',
  VALIDATION_FAILED: 'validation_failed',
  DUPLICATE_NAME: 'duplicate_name'
};

const COMPARABLE_FIELDS = [
  'name',
  'description',
  'priority',
  'conditions',
  'steps',
  'effective_from',
  'effective_to'
];

function normalizeValue(val) {
  return val === undefined ? null : val;
}

function deepEqual(a, b) {
  return JSON.stringify(normalizeValue(a)) === JSON.stringify(normalizeValue(b));
}

function calculateFieldDiff(existingRule, importedRule) {
  const diff = {};
  for (const field of COMPARABLE_FIELDS) {
    if (field === 'name') continue;
    const existing = normalizeValue(existingRule[field]);
    const imported = normalizeValue(importedRule[field]);
    if (!deepEqual(existing, imported)) {
      diff[field] = {
        old: existing,
        new: imported
      };
    }
  }
  return diff;
}

function validateSingleRule(rule, index, validRoles, allDepartments, allUsers) {
  const errors = [];
  const prefix = `规则[${index}] "${rule.name}"`;

  if (!rule.name || rule.name.trim() === '') {
    errors.push(`${prefix}: 规则名称不能为空`);
  }

  const validation = RuleEngine.validateRuleSteps(rule);
  if (!validation.valid) {
    errors.push(`${prefix}: 步骤验证失败: ${validation.errors.join('; ')}`);
  }

  for (const step of rule.steps) {
    for (const role of step.required_roles) {
      if (!validRoles.includes(role)) {
        errors.push(`${prefix}: 步骤 "${step.name}" 引用了无效角色: ${role}`);
      }
    }
  }

  if (rule.conditions && rule.conditions.type === 'simple' && rule.conditions.field === 'department_id') {
    const deptId = rule.conditions.value;
    if (deptId && !allDepartments.includes(deptId)) {
      errors.push(`${prefix}: 条件引用了不存在的部门ID: ${deptId}`);
    }
    if (rule.conditions.values) {
      for (const v of rule.conditions.values) {
        if (!allDepartments.includes(v)) {
          errors.push(`${prefix}: 条件引用了不存在的部门ID: ${v}`);
        }
      }
    }
  }

  return errors;
}

function calculateImportSummary(importData, options = {}) {
  const { includeNoChangeInAudit = false } = options;
  const summary = {
    total: 0,
    summary: {
      create: 0,
      update: 0,
      no_change: 0,
      priority_conflict: 0,
      validation_failed: 0,
      duplicate_name: 0
    },
    rules: [],
    warnings: [],
    errors: []
  };

  if (!importData || !importData.rules || !Array.isArray(importData.rules)) {
    summary.errors.push('导入数据格式错误，缺少 rules 数组');
    return summary;
  }

  const validRoles = ['applicant', 'department_manager', 'finance', 'legal', 'risk', 'ceo', 'admin'];
  const existingRules = ApprovalRule.findAll();
  const activeRules = existingRules.filter(r => r.is_active);
  const existingNames = existingRules.map(r => r.name);
  const activePriorities = activeRules.map(r => r.priority);
  const allDepartments = Department.findAll().map(d => d.id);
  const allUsers = User.findAll();

  const importedNames = importData.rules.map(r => r.name);
  const nameCounts = {};
  for (const name of importedNames) {
    nameCounts[name] = (nameCounts[name] || 0) + 1;
  }

  for (let i = 0; i < importData.rules.length; i++) {
    const importedRule = importData.rules[i];
    const ruleName = importedRule.name || `未命名规则[${i}]`;
    summary.total++;

    const ruleSummary = {
      index: i,
      name: ruleName,
      change_type: null,
      current_version: null,
      new_version: null,
      field_diff: {},
      validation_errors: [],
      conflict_details: null,
      should_audit: true
    };

    const duplicateInImport = nameCounts[ruleName] > 1;
    if (duplicateInImport) {
      ruleSummary.change_type = CHANGE_TYPES.DUPLICATE_NAME;
      ruleSummary.conflict_details = {
        type: 'duplicate_name_in_import',
        message: `导入的规则中存在重名: "${ruleName}" 出现 ${nameCounts[ruleName]} 次`
      };
      ruleSummary.validation_errors.push(ruleSummary.conflict_details.message);
      summary.summary.duplicate_name++;
      summary.errors.push(ruleSummary.conflict_details.message);
      summary.rules.push(ruleSummary);
      continue;
    }

    const validationErrors = validateSingleRule(importedRule, i, validRoles, allDepartments, allUsers);
    if (validationErrors.length > 0) {
      ruleSummary.change_type = CHANGE_TYPES.VALIDATION_FAILED;
      ruleSummary.validation_errors = validationErrors;
      summary.summary.validation_failed++;
      summary.errors.push(...validationErrors);
      summary.rules.push(ruleSummary);
      continue;
    }

    const existingActive = activeRules.find(r => r.name === ruleName);
    const existingAllVersions = existingRules.filter(r => r.name === ruleName);
    const maxExistingVersion = existingAllVersions.length > 0
      ? Math.max(...existingAllVersions.map(r => r.version))
      : 0;

    const priorityConflict = activePriorities.includes(importedRule.priority) &&
      (!existingActive || existingActive.priority !== importedRule.priority);

    if (priorityConflict) {
      const conflictingRule = activeRules.find(r =>
        r.is_active && r.priority === importedRule.priority && r.name !== ruleName
      );
      if (conflictingRule) {
        ruleSummary.change_type = CHANGE_TYPES.PRIORITY_CONFLICT;
        ruleSummary.current_version = existingActive ? existingActive.version : null;
        ruleSummary.new_version = maxExistingVersion + 1;
        ruleSummary.conflict_details = {
          type: 'priority_conflict',
          conflicting_rule_name: conflictingRule.name,
          conflicting_rule_id: conflictingRule.id,
          conflicting_priority: importedRule.priority,
          message: `优先级 ${importedRule.priority} 与现有规则 "${conflictingRule.name}" 冲突，导入后将按版本号排序`
        };
        summary.summary.priority_conflict++;
        summary.warnings.push(ruleSummary.conflict_details.message);

        if (existingActive) {
          ruleSummary.field_diff = calculateFieldDiff(existingActive, importedRule);
          if (Object.keys(ruleSummary.field_diff).length === 0) {
            ruleSummary.change_type = CHANGE_TYPES.PRIORITY_CONFLICT;
          }
        }

        ruleSummary.should_audit = includeNoChangeInAudit || Object.keys(ruleSummary.field_diff).length > 0;
        summary.rules.push(ruleSummary);
        continue;
      }
    }

    if (!existingActive) {
      ruleSummary.change_type = CHANGE_TYPES.CREATE;
      ruleSummary.new_version = 1;
      ruleSummary.should_audit = true;
      summary.summary.create++;

      if (existingAllVersions.length > 0) {
        ruleSummary.current_version = maxExistingVersion;
        ruleSummary.new_version = maxExistingVersion + 1;
        const lastVersion = existingAllVersions.find(r => r.version === maxExistingVersion);
        if (lastVersion) {
          ruleSummary.field_diff = calculateFieldDiff(lastVersion, importedRule);
        }
      }
      summary.rules.push(ruleSummary);
      continue;
    }

    ruleSummary.current_version = existingActive.version;
    ruleSummary.new_version = maxExistingVersion + 1;
    ruleSummary.field_diff = calculateFieldDiff(existingActive, importedRule);

    if (Object.keys(ruleSummary.field_diff).length === 0) {
      ruleSummary.change_type = CHANGE_TYPES.NO_CHANGE;
      ruleSummary.should_audit = includeNoChangeInAudit;
      summary.summary.no_change++;
    } else {
      ruleSummary.change_type = CHANGE_TYPES.UPDATE;
      ruleSummary.should_audit = true;
      summary.summary.update++;
    }

    summary.rules.push(ruleSummary);
  }

  return summary;
}

module.exports = {
  CHANGE_TYPES,
  calculateImportSummary,
  calculateFieldDiff
};
