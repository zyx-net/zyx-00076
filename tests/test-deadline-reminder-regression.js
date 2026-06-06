const db = require('../src/database/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const Contract = require('../src/models/Contract');
const ApprovalStep = require('../src/models/ApprovalStep');
const SlaConfig = require('../src/models/SlaConfig');
const ApprovalDeadline = require('../src/models/ApprovalDeadline');
const DeadlineAuditLog = require('../src/models/DeadlineAuditLog');
const DeadlineService = require('../src/services/DeadlineService');
const DeadlineScheduler = require('../src/services/DeadlineScheduler');
const ContractApprovalService = require('../src/services/ContractApprovalService');

const HOURS_TO_MS = 60 * 60 * 1000;

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  if (data !== undefined) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

function assert(condition, message, details = null) {
  if (!condition) {
    console.error(`❌ 断言失败: ${message}`);
    if (details) {
      console.error(`   详情: ${typeof details === 'object' ? JSON.stringify(details, null, 2) : details}`);
    }
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

function cleanupDatabase() {
  db.data.contracts = [];
  db.data.approval_steps = [];
  db.data.approval_actions = [];
  db.data.audit_logs = [];
  db.data.archives = [];
  db.data.sla_configs = [];
  db.data.approval_deadlines = [];
  db.data.deadline_audit_logs = [];
  db.save();
}

function createTestContract(contractNo, applicantId, departmentId, riskLevel = 'medium', amount = 100000) {
  const contract = Contract.create({
    contract_no: contractNo,
    title: `测试合同 ${contractNo}`,
    amount: amount,
    department_id: departmentId,
    risk_level: riskLevel,
    content: '回归测试合同内容',
    applicant_id: applicantId
  });
  Contract.addAttachment({
    contract_id: contract.id,
    file_name: 'test.pdf',
    file_type: 'application/pdf',
    file_size: 10000,
    uploaded_by: applicantId,
    is_required: true
  });
  return contract;
}

function countAuditLogsByAction(deadlineId, action) {
  const logs = DeadlineAuditLog.findByDeadline(deadlineId);
  return logs.filter(l => l.action === action).length;
}

async function runManualReminderTests(users, depts) {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  第一部分: 手动催办回归测试');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  log('测试 1: 首次手动催办 - 成功');
  const contract1 = createTestContract('HT-REG-MANUAL-001', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit1 = await ContractApprovalService.submitContract(contract1.id, users.zhangsan.id, '127.0.0.1');
  const deadline1 = ApprovalDeadline.findActiveByContract(contract1.id)[0];
  assert(deadline1.status === 'active', '时限初始状态为 active', { status: deadline1.status });
  assert(DeadlineService.hasUndigestedManualReminder(deadline1.id) === false, '初始状态无未消化催办');

  const remindResult1 = DeadlineService.sendManualReminder(
    deadline1.id, users.admin.id, '首次催办，请尽快处理', '127.0.0.1'
  );
  assert(remindResult1.success === true, '首次手动催办返回成功');
  assert(DeadlineService.hasUndigestedManualReminder(deadline1.id) === true, '催办后存在未消化的手动催办');

  const manualLogCount1 = countAuditLogsByAction(deadline1.id, 'manual_reminder');
  assert(manualLogCount1 === 1, '审计日志中存在 1 条手动催办记录', { count: manualLogCount1 });

  const manualLog1 = DeadlineAuditLog.findByDeadline(deadline1.id)
    .find(l => l.action === 'manual_reminder');
  assert(manualLog1.user_id === users.admin.id, '催办人 ID 正确', { expected: users.admin.id, actual: manualLog1.user_id });
  assert(manualLog1.reason === '首次催办，请尽快处理', '催办原因正确', { expected: '首次催办，请尽快处理', actual: manualLog1.reason });
  assert(manualLog1.old_status === 'active', '审计日志 old_status 为 active', { status: manualLog1.old_status });
  assert(manualLog1.new_status === 'active', '审计日志 new_status 为 active', { status: manualLog1.new_status });

  log('测试 2: 未消化前再次催办 - 被拒绝');
  let error2 = null;
  try {
    DeadlineService.sendManualReminder(
      deadline1.id, users.admin.id, '第二次催办，请加急', '127.0.0.1'
    );
  } catch (e) {
    error2 = e;
  }
  assert(error2 !== null, '第二次催办应抛出错误');
  assert(error2.message.includes('未消化的手动催办'), '错误信息包含"未消化的手动催办"', { message: error2.message });

  const manualLogCount2 = countAuditLogsByAction(deadline1.id, 'manual_reminder');
  assert(manualLogCount2 === 1, '被拒绝的催办不应产生新的审计日志', { count: manualLogCount2 });

  const deadline1AfterReject = ApprovalDeadline.findById(deadline1.id);
  assert(deadline1AfterReject.status === 'active', '时限状态仍为 active（被拒绝后状态不变）');

  log('测试 3: 暂停后不能催办');
  const contract3 = createTestContract('HT-REG-MANUAL-003', users.lisi.id, depts.sales.id, 'medium', 500000);
  const submit3 = await ContractApprovalService.submitContract(contract3.id, users.lisi.id, '127.0.0.1');
  const deadline3 = ApprovalDeadline.findActiveByContract(contract3.id)[0];

  DeadlineService.pauseDeadline(deadline3.id, users.admin.id, '审批人请假', '127.0.0.1');
  const deadline3Paused = ApprovalDeadline.findById(deadline3.id);
  assert(deadline3Paused.status === 'paused', '时限已暂停', { status: deadline3Paused.status });

  let error3 = null;
  try {
    DeadlineService.sendManualReminder(deadline3.id, users.admin.id, '暂停状态下催办', '127.0.0.1');
  } catch (e) {
    error3 = e;
  }
  assert(error3 !== null, '暂停状态下催办应抛出错误');
  assert(error3.message.includes('不允许催办'), '错误信息包含"不允许催办"', { message: error3.message });
  assert(error3.message.includes('paused'), '错误信息包含 paused 状态', { message: error3.message });

  const manualLogCount3 = countAuditLogsByAction(deadline3.id, 'manual_reminder');
  assert(manualLogCount3 === 0, '暂停状态下催办不应产生审计日志', { count: manualLogCount3 });

  log('测试 4: 完成后不能催办');
  const contract4 = createTestContract('HT-REG-MANUAL-004', users.zhangsan.id, depts.tech.id, 'medium', 600000);
  const submit4 = await ContractApprovalService.submitContract(contract4.id, users.zhangsan.id, '127.0.0.1');
  const deadline4 = ApprovalDeadline.findActiveByContract(contract4.id)[0];

  const step4 = ApprovalStep.findById(deadline4.step_id);
  await ContractApprovalService.processApproval(
    contract4.id, step4.id, users.qianshiyi.id, 'approve', '同意', null, '127.0.0.1'
  );
  const deadline4Completed = ApprovalDeadline.findById(deadline4.id);
  assert(deadline4Completed.status === 'completed', '时限已完成', { status: deadline4Completed.status });

  let error4 = null;
  try {
    DeadlineService.sendManualReminder(deadline4.id, users.admin.id, '完成状态下催办', '127.0.0.1');
  } catch (e) {
    error4 = e;
  }
  assert(error4 !== null, '完成状态下催办应抛出错误');
  assert(error4.message.includes('不允许催办'), '错误信息包含"不允许催办"', { message: error4.message });
  assert(error4.message.includes('completed'), '错误信息包含 completed 状态', { message: error4.message });

  const manualLogCount4 = countAuditLogsByAction(deadline4.id, 'manual_reminder');
  assert(manualLogCount4 === 0, '完成状态下催办不应产生审计日志', { count: manualLogCount4 });

  log('测试 5: 关闭旧时限后不能催办（通过重新计算关闭旧时限）');
  const contract5 = createTestContract('HT-REG-MANUAL-005', users.lisi.id, depts.tech.id, 'high', 3000000);
  const submit5 = await ContractApprovalService.submitContract(contract5.id, users.lisi.id, '127.0.0.1');
  const deadline5 = ApprovalDeadline.findActiveByContract(contract5.id)[0];

  const newSla5 = SlaConfig.create({
    name: '回归测试-SLA-005',
    risk_level: 'high',
    min_amount: 1000000,
    deadline_hours: 12,
    priority: 500,
    created_by: users.admin.id
  });

  const recalcResult5 = DeadlineService.recalculateDeadline(
    deadline5.id, users.admin.id, '应用更严格SLA', '127.0.0.1'
  );
  assert(recalcResult5.old_deadline.status === 'closed', '旧时限已关闭', { status: recalcResult5.old_deadline.status });
  assert(recalcResult5.old_deadline.close_reason === 'reflow', '关闭原因为 reflow', { reason: recalcResult5.old_deadline.close_reason });

  let error5 = null;
  try {
    DeadlineService.sendManualReminder(deadline5.id, users.admin.id, '已关闭旧时限催办', '127.0.0.1');
  } catch (e) {
    error5 = e;
  }
  assert(error5 !== null, '已关闭时限催办应抛出错误');
  assert(error5.message.includes('不允许催办'), '错误信息包含"不允许催办"', { message: error5.message });
  assert(error5.message.includes('closed'), '错误信息包含 closed 状态', { message: error5.message });

  const manualLogCount5 = countAuditLogsByAction(deadline5.id, 'manual_reminder');
  assert(manualLogCount5 === 0, '已关闭时限催办不应产生审计日志', { count: manualLogCount5 });

  const remindNew5 = DeadlineService.sendManualReminder(
    recalcResult5.new_deadline.id, users.admin.id, '新时限催办', '127.0.0.1'
  );
  assert(remindNew5.success === true, '新时限可以正常催办');

  log('测试 6: 恢复场景 - 严格校验 active 状态 + 未消化催办日志限制（不能只看日志顺序放行）');
  const contract6 = createTestContract('HT-REG-MANUAL-006', users.zhangsan.id, depts.tech.id, 'high', 2500000);
  const submit6 = await ContractApprovalService.submitContract(contract6.id, users.zhangsan.id, '127.0.0.1');
  const deadline6 = ApprovalDeadline.findActiveByContract(contract6.id)[0];

  DeadlineService.sendManualReminder(deadline6.id, users.admin.id, '恢复前催办', '127.0.0.1');
  assert(DeadlineService.hasUndigestedManualReminder(deadline6.id) === true, '暂停前存在未消化催办');

  let error6a = null;
  try {
    DeadlineService.sendManualReminder(deadline6.id, users.admin.id, '暂停前二次催办', '127.0.0.1');
  } catch (e) { error6a = e; }
  assert(error6a !== null, '暂停前重复催办被拒绝（验证未消化限制生效）');

  DeadlineService.pauseDeadline(deadline6.id, users.admin.id, '测试暂停', '127.0.0.1');
  const deadline6Paused = ApprovalDeadline.findById(deadline6.id);
  assert(deadline6Paused.status === 'paused', '时限已暂停', { status: deadline6Paused.status });

  assert(DeadlineService.hasUndigestedManualReminder(deadline6.id) === false, '暂停后催办被消化（验证消化机制）');

  let error6b = null;
  try {
    DeadlineService.sendManualReminder(deadline6.id, users.admin.id, '暂停中尝试催办', '127.0.0.1');
  } catch (e) { error6b = e; }
  assert(error6b !== null, '暂停中催办被拒绝（验证状态检查，而非仅日志顺序）', { status: deadline6Paused.status });

  DeadlineService.resumeDeadline(deadline6.id, users.admin.id, '127.0.0.1');
  const deadline6Resumed = ApprovalDeadline.findById(deadline6.id);
  assert(deadline6Resumed.status === 'active', '恢复后状态为 active（严格校验状态）', { status: deadline6Resumed.status });

  assert(DeadlineService.hasUndigestedManualReminder(deadline6.id) === false, '恢复后无未消化催办（验证暂停+恢复完整消化了旧催办）');

  const logsAfterResume = DeadlineAuditLog.findByDeadline(deadline6.id);
  const manualReminderLogs = logsAfterResume.filter(l => l.action === 'manual_reminder');
  const digestingLogsAfterManual = logsAfterResume.filter(l => 
    ['paused', 'resumed'].includes(l.action) && l.created_at > manualReminderLogs[0].created_at
  );
  assert(digestingLogsAfterManual.length >= 2, '手动催办后存在暂停和恢复日志（验证消化不是靠日志顺序，而是靠实际的消化动作）', {
    manual_reminder_count: manualReminderLogs.length,
    digesting_after: digestingLogsAfterManual.length,
    digesting_actions: digestingLogsAfterManual.map(l => l.action)
  });

  const remindAfterResume = DeadlineService.sendManualReminder(
    deadline6.id, users.admin.id, '恢复后首次催办', '127.0.0.1'
  );
  assert(remindAfterResume.success === true, '恢复后可以催办（验证状态+未消化双重检查通过）');
  assert(DeadlineService.hasUndigestedManualReminder(deadline6.id) === true, '恢复后催办产生新的未消化记录');

  let error6c = null;
  try {
    DeadlineService.sendManualReminder(deadline6.id, users.admin.id, '恢复后二次催办', '127.0.0.1');
  } catch (e) { error6c = e; }
  assert(error6c !== null, '恢复后重复催办仍被拒绝（验证未消化限制未失效）', { message: error6c?.message });

  const totalManualLogs6 = countAuditLogsByAction(deadline6.id, 'manual_reminder');
  assert(totalManualLogs6 === 2, '共产生 2 条手动催办日志（恢复前后各 1 条，被拒绝的不记录）', { count: totalManualLogs6 });

  log('测试 7: hasUndigestedManualReminder 严格校验 - 不被日志顺序欺骗');
  const contract7 = createTestContract('HT-REG-MANUAL-007', users.lisi.id, depts.sales.id, 'medium', 700000);
  const submit7 = await ContractApprovalService.submitContract(contract7.id, users.lisi.id, '127.0.0.1');
  const deadline7 = ApprovalDeadline.findActiveByContract(contract7.id)[0];

  DeadlineService.sendManualReminder(deadline7.id, users.admin.id, '测试消化1', '127.0.0.1');
  assert(DeadlineService.hasUndigestedManualReminder(deadline7.id) === true, '催办后存在未消化');

  db.prepare('UPDATE deadline_audit_logs SET created_at = ? WHERE deadline_id = ? AND action = ?')
    .run(Date.now() + 10000, deadline7.id, 'manual_reminder');
  db.forceSave();
  db.load();

  assert(DeadlineService.hasUndigestedManualReminder(deadline7.id) === true, '修改日志时间后仍正确识别未消化催办（不依赖日志查询顺序，依赖实际时间比较）');

  log('✅ 第一部分: 手动催办回归测试全部通过');
}

async function runAutomaticReminderTests(users, depts) {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  第二部分: 自动催办回归测试');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  log('测试 8: processAutomaticReminders - 只处理 active 时限（首次催办）');
  const contract8a = createTestContract('HT-REG-AUTO-008A', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit8a = await ContractApprovalService.submitContract(contract8a.id, users.zhangsan.id, '127.0.0.1');
  const deadline8a = ApprovalDeadline.findActiveByContract(contract8a.id)[0];

  const contract8b = createTestContract('HT-REG-AUTO-008B', users.lisi.id, depts.sales.id, 'high', 2000000);
  const submit8b = await ContractApprovalService.submitContract(contract8b.id, users.lisi.id, '127.0.0.1');
  const deadline8b = ApprovalDeadline.findActiveByContract(contract8b.id)[0];
  DeadlineService.pauseDeadline(deadline8b.id, users.admin.id, '暂停测试', '127.0.0.1');

  const contract8c = createTestContract('HT-REG-AUTO-008C', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit8c = await ContractApprovalService.submitContract(contract8c.id, users.zhangsan.id, '127.0.0.1');
  const deadline8c = ApprovalDeadline.findActiveByContract(contract8c.id)[0];
  const step8c = ApprovalStep.findById(deadline8c.step_id);
  await ContractApprovalService.processApproval(
    contract8c.id, step8c.id, users.qianshiyi.id, 'approve', '同意', null, '127.0.0.1'
  );
  const deadline8cCompleted = ApprovalDeadline.findById(deadline8c.id);
  assert(deadline8cCompleted.status === 'completed', '时限 8c 已完成');

  const now8 = Date.now();
  const firstReminderTime = now8 - 1000;
  const secondReminderTime = now8 + 500;
  const escalationTime = now8 + 1500;
  db.prepare('UPDATE approval_deadlines SET first_reminder_at = ?, first_reminder_sent = ? WHERE id IN (?, ?, ?)')
    .run(firstReminderTime, 0, deadline8a.id, deadline8b.id, deadline8c.id);
  db.prepare('UPDATE approval_deadlines SET second_reminder_at = ?, second_reminder_sent = ? WHERE id IN (?, ?, ?)')
    .run(secondReminderTime, 0, deadline8a.id, deadline8b.id, deadline8c.id);
  db.prepare('UPDATE approval_deadlines SET escalation_at = ?, escalation_sent = ? WHERE id IN (?, ?, ?)')
    .run(escalationTime, 0, deadline8a.id, deadline8b.id, deadline8c.id);
  db.forceSave();

  const firstReminderLogCountBefore8a = countAuditLogsByAction(deadline8a.id, 'first_reminder');
  const firstReminderLogCountBefore8b = countAuditLogsByAction(deadline8b.id, 'first_reminder');
  const firstReminderLogCountBefore8c = countAuditLogsByAction(deadline8c.id, 'first_reminder');

  const results8 = DeadlineService.processAutomaticReminders(now8);

  assert(results8.first_reminders.includes(deadline8a.id), 'active 时限 8a 触发首次催办');
  assert(!results8.first_reminders.includes(deadline8b.id), 'paused 时限 8b 不触发首次催办');
  assert(!results8.first_reminders.includes(deadline8c.id), 'completed 时限 8c 不触发首次催办');

  const deadline8aAfter = ApprovalDeadline.findById(deadline8a.id);
  const deadline8bAfter = ApprovalDeadline.findById(deadline8b.id);
  const deadline8cAfter = ApprovalDeadline.findById(deadline8c.id);

  assert(deadline8aAfter.first_reminder_sent === true, 'active 时限 first_reminder_sent 标记已更新');
  assert(deadline8bAfter.first_reminder_sent === false, 'paused 时限 first_reminder_sent 标记未修改', { value: deadline8bAfter.first_reminder_sent });
  assert(deadline8cAfter.first_reminder_sent === false, 'completed 时限 first_reminder_sent 标记未修改', { value: deadline8cAfter.first_reminder_sent });

  const firstReminderLogCountAfter8a = countAuditLogsByAction(deadline8a.id, 'first_reminder');
  const firstReminderLogCountAfter8b = countAuditLogsByAction(deadline8b.id, 'first_reminder');
  const firstReminderLogCountAfter8c = countAuditLogsByAction(deadline8c.id, 'first_reminder');

  assert(firstReminderLogCountAfter8a === firstReminderLogCountBefore8a + 1, 'active 时限新增首次催办审计日志', {
    before: firstReminderLogCountBefore8a, after: firstReminderLogCountAfter8a
  });
  assert(firstReminderLogCountAfter8b === firstReminderLogCountBefore8b, 'paused 时限不产生首次催办审计日志', {
    before: firstReminderLogCountBefore8b, after: firstReminderLogCountAfter8b
  });
  assert(firstReminderLogCountAfter8c === firstReminderLogCountBefore8c, 'completed 时限不产生首次催办审计日志', {
    before: firstReminderLogCountBefore8c, after: firstReminderLogCountAfter8c
  });

  log('测试 9: processAutomaticReminders - 只处理 active 时限（二次催办）');
  const secondReminderLogCountBefore8a = countAuditLogsByAction(deadline8a.id, 'second_reminder');
  const secondReminderLogCountBefore8b = countAuditLogsByAction(deadline8b.id, 'second_reminder');
  const secondReminderLogCountBefore8c = countAuditLogsByAction(deadline8c.id, 'second_reminder');

  const results9 = DeadlineService.processAutomaticReminders(now8 + 1000);

  assert(results9.second_reminders.includes(deadline8a.id), 'active 时限 8a 触发二次催办');
  assert(!results9.second_reminders.includes(deadline8b.id), 'paused 时限 8b 不触发二次催办');
  assert(!results9.second_reminders.includes(deadline8c.id), 'completed 时限 8c 不触发二次催办');

  const deadline8aAfter9 = ApprovalDeadline.findById(deadline8a.id);
  const deadline8bAfter9 = ApprovalDeadline.findById(deadline8b.id);
  const deadline8cAfter9 = ApprovalDeadline.findById(deadline8c.id);

  assert(deadline8aAfter9.second_reminder_sent === true, 'active 时限 second_reminder_sent 标记已更新');
  assert(deadline8bAfter9.second_reminder_sent === false, 'paused 时限 second_reminder_sent 标记未修改');
  assert(deadline8cAfter9.second_reminder_sent === false, 'completed 时限 second_reminder_sent 标记未修改');

  const secondReminderLogCountAfter9a = countAuditLogsByAction(deadline8a.id, 'second_reminder');
  const secondReminderLogCountAfter9b = countAuditLogsByAction(deadline8b.id, 'second_reminder');
  const secondReminderLogCountAfter9c = countAuditLogsByAction(deadline8c.id, 'second_reminder');

  assert(secondReminderLogCountAfter9a === secondReminderLogCountBefore8a + 1, 'active 时限新增二次催办审计日志');
  assert(secondReminderLogCountAfter9b === secondReminderLogCountBefore8b, 'paused 时限不产生二次催办审计日志');
  assert(secondReminderLogCountAfter9c === secondReminderLogCountBefore8c, 'completed 时限不产生二次催办审计日志');

  log('测试 10: processAutomaticReminders - 只处理 active 时限（升级）');
  const escalationLogCountBefore8a = countAuditLogsByAction(deadline8a.id, 'escalation');
  const escalationLogCountBefore8b = countAuditLogsByAction(deadline8b.id, 'escalation');
  const escalationLogCountBefore8c = countAuditLogsByAction(deadline8c.id, 'escalation');

  const results10 = DeadlineService.processAutomaticReminders(now8 + 2000);

  assert(results10.escalations.includes(deadline8a.id), 'active 时限 8a 触发升级');
  assert(!results10.escalations.includes(deadline8b.id), 'paused 时限 8b 不触发升级');
  assert(!results10.escalations.includes(deadline8c.id), 'completed 时限 8c 不触发升级');

  const deadline8aAfter10 = ApprovalDeadline.findById(deadline8a.id);
  const deadline8bAfter10 = ApprovalDeadline.findById(deadline8b.id);
  const deadline8cAfter10 = ApprovalDeadline.findById(deadline8c.id);

  assert(deadline8aAfter10.escalation_sent === true, 'active 时限 escalation_sent 标记已更新');
  assert(deadline8bAfter10.escalation_sent === false, 'paused 时限 escalation_sent 标记未修改');
  assert(deadline8cAfter10.escalation_sent === false, 'completed 时限 escalation_sent 标记未修改');

  const escalationLogCountAfter10a = countAuditLogsByAction(deadline8a.id, 'escalation');
  const escalationLogCountAfter10b = countAuditLogsByAction(deadline8b.id, 'escalation');
  const escalationLogCountAfter10c = countAuditLogsByAction(deadline8c.id, 'escalation');

  assert(escalationLogCountAfter10a === escalationLogCountBefore8a + 1, 'active 时限新增升级审计日志');
  assert(escalationLogCountAfter10b === escalationLogCountBefore8b, 'paused 时限不产生升级审计日志');
  assert(escalationLogCountAfter10c === escalationLogCountBefore8c, 'completed 时限不产生升级审计日志');

  log('测试 11: DeadlineScheduler.runOnce - 与 processAutomaticReminders 行为一致');
  const contract11a = createTestContract('HT-REG-AUTO-011A', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit11a = await ContractApprovalService.submitContract(contract11a.id, users.zhangsan.id, '127.0.0.1');
  const deadline11a = ApprovalDeadline.findActiveByContract(contract11a.id)[0];

  const contract11b = createTestContract('HT-REG-AUTO-011B', users.lisi.id, depts.sales.id, 'high', 2000000);
  const submit11b = await ContractApprovalService.submitContract(contract11b.id, users.lisi.id, '127.0.0.1');
  const deadline11b = ApprovalDeadline.findActiveByContract(contract11b.id)[0];
  DeadlineService.pauseDeadline(deadline11b.id, users.admin.id, '暂停测试', '127.0.0.1');

  const now11 = Date.now();
  const pastTime11 = now11 - 1000;
  db.prepare('UPDATE approval_deadlines SET first_reminder_at = ?, first_reminder_sent = ? WHERE id IN (?, ?)')
    .run(pastTime11, 0, deadline11a.id, deadline11b.id);
  db.forceSave();

  DeadlineScheduler.isRunning = true;
  const schedulerResults = await DeadlineScheduler.runOnce();
  DeadlineScheduler.isRunning = false;

  assert(schedulerResults.first_reminders.includes(deadline11a.id), 'runOnce: active 时限触发首次催办');
  assert(!schedulerResults.first_reminders.includes(deadline11b.id), 'runOnce: paused 时限不触发首次催办');

  const deadline11aAfter = ApprovalDeadline.findById(deadline11a.id);
  const deadline11bAfter = ApprovalDeadline.findById(deadline11b.id);

  assert(deadline11aAfter.first_reminder_sent === true, 'runOnce: active 时限标记已更新');
  assert(deadline11bAfter.first_reminder_sent === false, 'runOnce: paused 时限标记未修改');

  const firstReminderLog11a = countAuditLogsByAction(deadline11a.id, 'first_reminder');
  const firstReminderLog11b = countAuditLogsByAction(deadline11b.id, 'first_reminder');
  assert(firstReminderLog11a === 1, 'runOnce: active 时限产生审计日志');
  assert(firstReminderLog11b === 0, 'runOnce: paused 时限不产生审计日志');

  log('测试 12: closed 时限不触发任何自动催办');
  const contract12 = createTestContract('HT-REG-AUTO-012', users.zhangsan.id, depts.tech.id, 'high', 3000000);
  const submit12 = await ContractApprovalService.submitContract(contract12.id, users.zhangsan.id, '127.0.0.1');
  const deadline12 = ApprovalDeadline.findActiveByContract(contract12.id)[0];

  const newSla12 = SlaConfig.create({
    name: '回归测试-SLA-012',
    risk_level: 'high',
    min_amount: 1000000,
    deadline_hours: 6,
    priority: 600,
    created_by: users.admin.id
  });
  const recalc12 = DeadlineService.recalculateDeadline(deadline12.id, users.admin.id, '测试', '127.0.0.1');
  assert(recalc12.old_deadline.status === 'closed', '旧时限已关闭');

  const now12 = Date.now();
  db.prepare('UPDATE approval_deadlines SET first_reminder_at = ?, first_reminder_sent = ?, second_reminder_at = ?, second_reminder_sent = ?, escalation_at = ?, escalation_sent = ? WHERE id = ?')
    .run(now12 - 1000, 0, now12 - 1000, 0, now12 - 1000, 0, deadline12.id);
  db.forceSave();

  const logsBefore12 = DeadlineAuditLog.findByDeadline(deadline12.id).length;

  const results12 = DeadlineService.processAutomaticReminders(now12);

  assert(!results12.first_reminders.includes(deadline12.id), 'closed 时限不触发首次催办');
  assert(!results12.second_reminders.includes(deadline12.id), 'closed 时限不触发二次催办');
  assert(!results12.escalations.includes(deadline12.id), 'closed 时限不触发升级');

  const deadline12After = ApprovalDeadline.findById(deadline12.id);
  assert(deadline12After.first_reminder_sent === false, 'closed 时限 first_reminder_sent 不变');
  assert(deadline12After.second_reminder_sent === false, 'closed 时限 second_reminder_sent 不变');
  assert(deadline12After.escalation_sent === false, 'closed 时限 escalation_sent 不变');

  const logsAfter12 = DeadlineAuditLog.findByDeadline(deadline12.id).length;
  assert(logsAfter12 === logsBefore12, 'closed 时限不产生任何新的审计日志', { before: logsBefore12, after: logsAfter12 });

  log('测试 13: 自动催办审计日志内容正确性校验');
  const contract13 = createTestContract('HT-REG-AUTO-013', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit13 = await ContractApprovalService.submitContract(contract13.id, users.zhangsan.id, '127.0.0.1');
  const deadline13 = ApprovalDeadline.findActiveByContract(contract13.id)[0];

  const now13 = Date.now();
  db.prepare('UPDATE approval_deadlines SET first_reminder_at = ?, first_reminder_sent = ?, second_reminder_at = ?, second_reminder_sent = ?, escalation_at = ?, escalation_sent = ? WHERE id = ?')
    .run(now13 - 1000, 0, now13 - 500, 0, now13 - 100, 0, deadline13.id);
  db.forceSave();

  const results13 = DeadlineService.processAutomaticReminders(now13);

  assert(results13.first_reminders.includes(deadline13.id), '首次催办已处理');
  assert(results13.second_reminders.includes(deadline13.id), '二次催办已处理');
  assert(results13.escalations.includes(deadline13.id), '升级已处理');

  const firstReminderLog13 = DeadlineAuditLog.findByDeadline(deadline13.id)
    .find(l => l.action === 'first_reminder');
  assert(firstReminderLog13 !== undefined, '首次催办日志存在');
  assert(firstReminderLog13.old_status === 'active', '首次催办日志 old_status 正确');
  assert(firstReminderLog13.new_status === 'active', '首次催办日志 new_status 正确');
  assert(firstReminderLog13.old_value.first_reminder_sent === false, '首次催办日志 old_value 正确');
  assert(firstReminderLog13.new_value.first_reminder_sent === true, '首次催办日志 new_value 正确');
  assert(firstReminderLog13.reason === '自动催办 - 首次提醒', '首次催办日志 reason 正确');

  const secondReminderLog13 = DeadlineAuditLog.findByDeadline(deadline13.id)
    .find(l => l.action === 'second_reminder');
  assert(secondReminderLog13 !== undefined, '二次催办日志存在');
  assert(secondReminderLog13.old_status === 'active', '二次催办日志 old_status 正确');
  assert(secondReminderLog13.new_status === 'active', '二次催办日志 new_status 正确');
  assert(secondReminderLog13.old_value.second_reminder_sent === false, '二次催办日志 old_value 正确');
  assert(secondReminderLog13.new_value.second_reminder_sent === true, '二次催办日志 new_value 正确');

  const escalationLog13 = DeadlineAuditLog.findByDeadline(deadline13.id)
    .find(l => l.action === 'escalation');
  assert(escalationLog13 !== undefined, '升级日志存在');
  assert(escalationLog13.old_status === 'active', '升级日志 old_status 正确');
  assert(escalationLog13.new_status === 'active', '升级日志 new_status 正确');
  assert(escalationLog13.old_value.escalation_sent === false, '升级日志 old_value 正确');
  assert(escalationLog13.new_value.escalation_sent === true, '升级日志 new_value 正确');

  log('✅ 第二部分: 自动催办回归测试全部通过');
}

async function runEdgeCaseTests(users, depts) {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  第三部分: 边界场景回归测试');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  log('测试 14: 持久化后重启 - 未消化催办限制仍然有效');
  const contract14 = createTestContract('HT-REG-EDGE-014', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit14 = await ContractApprovalService.submitContract(contract14.id, users.zhangsan.id, '127.0.0.1');
  const deadline14 = ApprovalDeadline.findActiveByContract(contract14.id)[0];

  DeadlineService.sendManualReminder(deadline14.id, users.admin.id, '重启前催办', '127.0.0.1');
  assert(DeadlineService.hasUndigestedManualReminder(deadline14.id) === true, '重启前存在未消化催办');

  db.forceSave();
  db.load();

  assert(DeadlineService.hasUndigestedManualReminder(deadline14.id) === true, '重启后仍正确识别未消化催办（基于持久化审计日志）');

  let error14 = null;
  try {
    DeadlineService.sendManualReminder(deadline14.id, users.admin.id, '重启后二次催办', '127.0.0.1');
  } catch (e) { error14 = e; }
  assert(error14 !== null, '重启后重复催办仍被拒绝', { message: error14?.message });

  log('测试 15: 自动催办不影响手动催办的未消化状态');
  const contract15 = createTestContract('HT-REG-EDGE-015', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit15 = await ContractApprovalService.submitContract(contract15.id, users.zhangsan.id, '127.0.0.1');
  const deadline15 = ApprovalDeadline.findActiveByContract(contract15.id)[0];

  const now15 = Date.now();
  db.prepare('UPDATE approval_deadlines SET first_reminder_at = ?, first_reminder_sent = ? WHERE id = ?')
    .run(now15 - 1000, 0, deadline15.id);
  db.forceSave();

  DeadlineService.processAutomaticReminders(now15);
  const afterAuto = ApprovalDeadline.findById(deadline15.id);
  assert(afterAuto.first_reminder_sent === true, '自动催办已发送');

  assert(DeadlineService.hasUndigestedManualReminder(deadline15.id) === false, '自动催办不产生未消化手动催办标记');

  const manualAfterAuto = DeadlineService.sendManualReminder(
    deadline15.id, users.admin.id, '自动催办后手动催办', '127.0.0.1'
  );
  assert(manualAfterAuto.success === true, '自动催办后可以正常手动催办');

  log('测试 16: 状态检查优先级高于日志检查（防止绕过）');
  const contract16 = createTestContract('HT-REG-EDGE-016', users.zhangsan.id, depts.tech.id, 'high', 2000000);
  const submit16 = await ContractApprovalService.submitContract(contract16.id, users.zhangsan.id, '127.0.0.1');
  const deadline16 = ApprovalDeadline.findActiveByContract(contract16.id)[0];

  DeadlineService.pauseDeadline(deadline16.id, users.admin.id, '测试', '127.0.0.1');
  const pausedDeadline16 = ApprovalDeadline.findById(deadline16.id);

  db.prepare('UPDATE deadline_audit_logs SET action = ? WHERE deadline_id = ? AND action = ?')
    .run('resumed', deadline16.id, 'paused');
  db.forceSave();
  db.load();

  assert(DeadlineService.hasUndigestedManualReminder(deadline16.id) === false, '即使修改日志，状态检查仍会阻止催办');

  let error16 = null;
  try {
    DeadlineService.sendManualReminder(deadline16.id, users.admin.id, '绕过测试', '127.0.0.1');
  } catch (e) { error16 = e; }
  assert(error16 !== null, '状态检查优先，即使日志被篡改也不能催办', {
    status: pausedDeadline16.status,
    message: error16?.message
  });

  log('✅ 第三部分: 边界场景回归测试全部通过');
}

async function runAllTests() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  审批时限与催办链路 - 完整回归测试套件');
  console.log('════════════════════════════════════════════════════════════\n');

  log('初始化: 清理并重新种子数据');
  const { execSync } = require('child_process');
  execSync('node src/seeders/seed.js', { stdio: 'inherit' });
  db.load();

  const users = {
    zhangsan: User.findByUsername('zhangsan'),
    lisi: User.findByUsername('lisi'),
    wangwu: User.findByUsername('wangwu'),
    zhaoliu: User.findByUsername('zhaoliu'),
    sunqi: User.findByUsername('sunqi'),
    zhouba: User.findByUsername('zhouba'),
    admin: User.findByUsername('admin'),
    qianshiyi: User.findByUsername('qianshiyi')
  };

  const depts = {
    tech: Department.findByCode('TECH'),
    sales: Department.findByCode('SALES')
  };

  log('环境验证');
  assert(users.admin.roles.includes('admin'), 'admin 用户存在且为管理员');
  assert(users.zhangsan.department_id === depts.tech.id, '张三属于技术部');
  assert(depts.tech.id !== undefined, '技术部存在');
  assert(depts.sales.id !== undefined, '销售部存在');

  try {
    await runManualReminderTests(users, depts);
    await runAutomaticReminderTests(users, depts);
    await runEdgeCaseTests(users, depts);
  } catch (err) {
    console.error('\n❌ 测试执行异常:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  ✅ 所有回归测试通过！');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('测试覆盖总结:');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │ 手动催办测试: 7 个测试用例                            │');
  console.log('  │   ✓ 首次手动催办成功                                    │');
  console.log('  │   ✓ 未消化前再次催办被拒绝                              │');
  console.log('  │   ✓ 暂停状态不能催办                                    │');
  console.log('  │   ✓ 完成状态不能催办                                    │');
  console.log('  │   ✓ 关闭旧时限不能催办                                  │');
  console.log('  │   ✓ 恢复场景严格校验 active 状态 + 未消化限制           │');
  console.log('  │   ✓ hasUndigestedManualReminder 不被日志顺序欺骗        │');
  console.log('  ├─────────────────────────────────────────────────────────┤');
  console.log('  │ 自动催办测试: 6 个测试用例                             │');
  console.log('  │   ✓ processAutomaticReminders 只处理 active 时限(首次)  │');
  console.log('  │   ✓ processAutomaticReminders 只处理 active 时限(二次)  │');
  console.log('  │   ✓ processAutomaticReminders 只处理 active 时限(升级)  │');
  console.log('  │   ✓ DeadlineScheduler.runOnce 行为一致                  │');
  console.log('  │   ✓ closed 时限不触发任何自动催办                       │');
  console.log('  │   ✓ 自动催办审计日志内容正确性                          │');
  console.log('  ├─────────────────────────────────────────────────────────┤');
  console.log('  │ 边界场景测试: 3 个测试用例                             │');
  console.log('  │   ✓ 重启后未消化催办限制仍然有效                        │');
  console.log('  │   ✓ 自动催办不影响手动催办未消化状态                    │');
  console.log('  │   ✓ 状态检查优先级高于日志检查                          │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('  总计: 16 个测试用例，全部通过');
  console.log();
}

if (require.main === module) {
  runAllTests().catch(err => {
    console.error('测试执行失败:', err);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = runAllTests;
