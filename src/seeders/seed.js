const db = require('../database/db');
const Department = require('../models/Department');
const User = require('../models/User');
const ApprovalRule = require('../models/ApprovalRule');

function clearDatabase() {
  console.log('清空现有数据...');
  db.prepare('DELETE FROM contract_attachments').run();
  db.prepare('DELETE FROM approval_actions').run();
  db.prepare('DELETE FROM approval_steps').run();
  db.prepare('DELETE FROM archives').run();
  db.prepare('DELETE FROM audit_logs').run();
  db.prepare('DELETE FROM contracts').run();
  db.prepare('DELETE FROM approval_rules').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM departments').run();
  console.log('数据已清空\n');
}

function seedDepartments() {
  console.log('创建部门数据...');
  
  const tech = Department.create({ name: '技术部', code: 'TECH' });
  const sales = Department.create({ name: '销售部', code: 'SALES' });
  const finance = Department.create({ name: '财务部', code: 'FIN' });
  const legal = Department.create({ name: '法务部', code: 'LEGAL' });
  const hr = Department.create({ name: '人力资源部', code: 'HR' });
  const risk = Department.create({ name: '风险管理部', code: 'RISK' });
  
  console.log(`  ✓ 技术部 (${tech.id})`);
  console.log(`  ✓ 销售部 (${sales.id})`);
  console.log(`  ✓ 财务部 (${finance.id})`);
  console.log(`  ✓ 法务部 (${legal.id})`);
  console.log(`  ✓ 人力资源部 (${hr.id})`);
  console.log(`  ✓ 风险管理部 (${risk.id})`);
  console.log();
  
  return { tech, sales, finance, legal, hr, risk };
}

function seedUsers(depts) {
  console.log('创建用户数据...');
  
  const admin = User.create({
    username: 'admin',
    name: '系统管理员',
    email: 'admin@company.com',
    roles: ['admin'],
    department_id: null
  });
  
  const zhangsan = User.create({
    username: 'zhangsan',
    name: '张三',
    email: 'zhangsan@company.com',
    roles: ['applicant', 'department_manager'],
    department_id: depts.tech.id
  });
  
  const lisi = User.create({
    username: 'lisi',
    name: '李四',
    email: 'lisi@company.com',
    roles: ['applicant'],
    department_id: depts.sales.id
  });
  
  const wangwu = User.create({
    username: 'wangwu',
    name: '王五',
    email: 'wangwu@company.com',
    roles: ['finance'],
    department_id: depts.finance.id
  });
  
  const zhaoliu = User.create({
    username: 'zhaoliu',
    name: '赵六',
    email: 'zhaoliu@company.com',
    roles: ['legal'],
    department_id: depts.legal.id
  });
  
  const sunqi = User.create({
    username: 'sunqi',
    name: '孙七',
    email: 'sunqi@company.com',
    roles: ['risk'],
    department_id: depts.risk.id
  });
  
  const zhouba = User.create({
    username: 'zhouba',
    name: '周八',
    email: 'zhouba@company.com',
    roles: ['ceo', 'admin'],
    department_id: null
  });
  
  const wujiu = User.create({
    username: 'wujiu',
    name: '吴九',
    email: 'wujiu@company.com',
    roles: ['finance', 'risk'],
    department_id: depts.finance.id
  });
  
  const zhengshi = User.create({
    username: 'zhengshi',
    name: '郑十',
    email: 'zhengshi@company.com',
    roles: ['legal'],
    department_id: depts.legal.id
  });
  
  const qianshiyi = User.create({
    username: 'qianshiyi',
    name: '钱十一',
    email: 'qianshiyi@company.com',
    roles: ['department_manager'],
    department_id: depts.tech.id
  });
  
  console.log(`  ✓ 系统管理员 (admin) - 角色: [admin]`);
  console.log(`  ✓ 张三 (zhangsan) - 角色: [applicant, department_manager] - 技术部`);
  console.log(`  ✓ 李四 (lisi) - 角色: [applicant] - 销售部`);
  console.log(`  ✓ 王五 (wangwu) - 角色: [finance] - 财务部`);
  console.log(`  ✓ 赵六 (zhaoliu) - 角色: [legal] - 法务部`);
  console.log(`  ✓ 孙七 (sunqi) - 角色: [risk] - 风险管理部`);
  console.log(`  ✓ 周八 (zhouba) - 角色: [ceo, admin] - CEO`);
  console.log(`  ✓ 吴九 (wujiu) - 角色: [finance, risk] - 财务部`);
  console.log(`  ✓ 郑十 (zhengshi) - 角色: [legal] - 法务部`);
  console.log(`  ✓ 钱十一 (qianshiyi) - 角色: [department_manager] - 技术部`);
  console.log();
  
  return { admin, zhangsan, lisi, wangwu, zhaoliu, sunqi, zhouba, wujiu, zhengshi, qianshiyi };
}

function seedRules(users, depts) {
  console.log('创建审批规则...');
  
  const rule1 = ApprovalRule.create({
    name: '低风险小额合同',
    description: '金额 < 10万，低风险，技术部/销售部的合同',
    priority: 10,
    conditions: {
      type: 'composite',
      logic: 'AND',
      conditions: [
        { type: 'simple', field: 'amount', operator: 'less_than', value: 100000 },
        { type: 'simple', field: 'risk_level', operator: 'equals', value: 'low' },
        { type: 'simple', field: 'department_id', operator: 'in', values: [depts.tech.id, depts.sales.id] }
      ]
    },
    steps: [
      {
        name: '部门经理审批',
        type: 'single',
        required_roles: ['department_manager']
      },
      {
        name: '财务审核',
        type: 'single',
        required_roles: ['finance']
      }
    ],
    created_by: users.admin.id
  });
  
  const rule2 = ApprovalRule.create({
    name: '中风险中等金额合同',
    description: '10万 ≤ 金额 < 100万，中风险，所有部门',
    priority: 20,
    conditions: {
      type: 'composite',
      logic: 'AND',
      conditions: [
        { type: 'simple', field: 'amount', operator: 'between', values: [100000, 999999.99] },
        { type: 'simple', field: 'risk_level', operator: 'equals', value: 'medium' }
      ]
    },
    steps: [
      {
        name: '部门经理审批',
        type: 'single',
        required_roles: ['department_manager']
      },
      {
        name: '财务审核',
        type: 'single',
        required_roles: ['finance']
      },
      {
        name: '法务审核',
        type: 'single',
        required_roles: ['legal']
      }
    ],
    created_by: users.admin.id
  });
  
  const rule3 = ApprovalRule.create({
    name: '高风险大额合同',
    description: '金额 ≥ 100万 或 高风险，需要会签',
    priority: 50,
    conditions: {
      type: 'composite',
      logic: 'OR',
      conditions: [
        { type: 'simple', field: 'amount', operator: 'greater_than_or_equal', value: 1000000 },
        { type: 'simple', field: 'risk_level', operator: 'in', values: ['high', 'critical'] }
      ]
    },
    steps: [
      {
        name: '部门经理审批',
        type: 'single',
        required_roles: ['department_manager']
      },
      {
        name: '财务和风险会签 (需2人)',
        type: 'countersign',
        required_roles: ['finance', 'risk'],
        required_signatures: 2
      },
      {
        name: '法务双人会签 (需2人)',
        type: 'countersign',
        required_roles: ['legal'],
        required_signatures: 2
      },
      {
        name: 'CEO最终审批',
        type: 'single',
        required_roles: ['ceo']
      }
    ],
    created_by: users.admin.id
  });
  
  const rule4 = ApprovalRule.create({
    name: '销售部特殊合同',
    description: '销售部所有合同额外增加风控审核',
    priority: 30,
    conditions: {
      type: 'composite',
      logic: 'AND',
      conditions: [
        { type: 'simple', field: 'department_id', operator: 'equals', value: depts.sales.id },
        { type: 'simple', field: 'amount', operator: 'greater_than_or_equal', value: 500000 }
      ]
    },
    steps: [
      {
        name: '部门经理审批',
        type: 'single',
        required_roles: ['department_manager']
      },
      {
        name: '风控初审',
        type: 'single',
        required_roles: ['risk']
      },
      {
        name: '财务审核',
        type: 'single',
        required_roles: ['finance']
      },
      {
        name: '法务审核',
        type: 'single',
        required_roles: ['legal']
      }
    ],
    created_by: users.admin.id
  });
  
  console.log(`  ✓ 低风险小额合同 v${rule1.version} (优先级: ${rule1.priority})`);
  console.log(`  ✓ 中风险中等金额合同 v${rule2.version} (优先级: ${rule2.priority})`);
  console.log(`  ✓ 高风险大额合同 v${rule3.version} (优先级: ${rule3.priority}) - 含会签步骤`);
  console.log(`  ✓ 销售部特殊合同 v${rule4.version} (优先级: ${rule4.priority})`);
  console.log();
  
  return { rule1, rule2, rule3, rule4 };
}

function main() {
  console.log('\n========================================');
  console.log('  合同审批系统 - 种子数据初始化');
  console.log('========================================\n');
  
  try {
    clearDatabase();
    
    const depts = seedDepartments();
    const users = seedUsers(depts);
    const rules = seedRules(users, depts);
    
    console.log('========================================');
    console.log('  种子数据初始化完成！');
    console.log('========================================\n');
    
    console.log('用户快速参考:');
    console.log(`  管理员 ID: ${users.admin.id}`);
    console.log(`  张三 (技术部经理) ID: ${users.zhangsan.id}`);
    console.log(`  李四 (销售) ID: ${users.lisi.id}`);
    console.log(`  王五 (财务) ID: ${users.wangwu.id}`);
    console.log(`  赵六 (法务) ID: ${users.zhaoliu.id}`);
    console.log(`  孙七 (风控) ID: ${users.sunqi.id}`);
    console.log(`  周八 (CEO) ID: ${users.zhouba.id}`);
    console.log();
    
    console.log('部门快速参考:');
    console.log(`  技术部 ID: ${depts.tech.id}`);
    console.log(`  销售部 ID: ${depts.sales.id}`);
    console.log(`  财务部 ID: ${depts.finance.id}`);
    console.log(`  法务部 ID: ${depts.legal.id}`);
    console.log(`  风控部 ID: ${depts.risk.id}`);
    console.log();
    
    console.log('规则快速参考:');
    console.log(`  高风险大额合同 ID: ${rules.rule3.id}`);
    console.log(`  中风险中等金额合同 ID: ${rules.rule2.id}`);
    console.log();
    
    db.forceSave();
    
  } catch (err) {
    console.error('种子数据初始化失败:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = async function seed(clearFirst = false) {
  if (clearFirst) {
    clearDatabase();
  }
  const depts = seedDepartments();
  const users = seedUsers(depts);
  const rules = seedRules(users, depts);
  db.forceSave();
  return { depts, users, rules };
};
