# 合同审批路由与归档 API 文档

## 服务信息
- **基础地址**: `http://localhost:3000`
- **认证方式**: 请求头 `x-user-id` 传入用户ID
- **数据格式**: JSON

---

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 初始化种子数据
```bash
npm run seed
```

### 3. 启动服务
```bash
npm start
```

### 4. 健康检查
```bash
curl http://localhost:3000/health
```

---

## 种子用户

执行 `npm run seed` 后会输出用户 ID，以下是默认用户：

| 用户名 | 姓名 | 角色 | 部门 |
|--------|------|------|------|
| admin | 系统管理员 | admin | - |
| zhangsan | 张三 | applicant, department_manager | 技术部 |
| lisi | 李四 | applicant | 销售部 |
| wangwu | 王五 | finance | 财务部 |
| zhaoliu | 赵六 | legal | 法务部 |
| sunqi | 孙七 | risk | 风险管理部 |
| zhouba | 周八 | ceo, admin | - |
| wujiu | 吴九 | finance, risk | 财务部 |
| zhengshi | 郑十 | legal | 法务部 |

---

## 核心角色说明

| 角色 | 说明 |
|------|------|
| applicant | 申请人，可创建和提交合同 |
| department_manager | 部门经理，审批本部门合同 |
| finance | 财务，审核合同金额相关 |
| legal | 法务，审核合同法律条款 |
| risk | 风控，审核合同风险 |
| ceo | CEO，大额/高风险合同最终审批 |
| admin | 管理员，管理规则和部门 |

---

## API 接口列表

### 一、合同管理

#### 1. 创建合同
```http
POST /api/contracts
x-user-id: <用户ID>
Content-Type: application/json

{
  "contract_no": "HT-2025-001",
  "title": "技术服务合同",
  "amount": 500000,
  "currency": "CNY",
  "department_id": "<部门ID>",
  "risk_level": "medium",
  "content": "合同正文内容...",
  "attachments": [
    {
      "file_name": "合同正文.pdf",
      "file_type": "application/pdf",
      "file_size": 102400,
      "is_required": true
    }
  ]
}
```

#### 2. 提交合同审批
```http
POST /api/contracts/:id/submit
x-user-id: <用户ID>
```

**响应示例**:
```json
{
  "contract": { ... },
  "rule": {
    "id": "rule-uuid",
    "name": "中风险中等金额合同",
    "version": 1
  },
  "hit_reason": [
    "AND: ✓",
    "  amount between [100000,999999.99]: ✓ (actual: 500000)",
    "  risk_level equals medium: ✓ (actual: medium)"
  ],
  "current_step": { ... }
}
```

#### 3. 获取合同列表
```http
GET /api/contracts
GET /api/contracts?status=approving
GET /api/contracts?applicant_id=<用户ID>
```

#### 4. 获取合同详情
```http
GET /api/contracts/:id
```

**包含信息**: 合同基本信息、附件、审批步骤、审批意见、匹配规则、命中原因

#### 5. 获取合同当前步骤
```http
GET /api/contracts/:id/current-step
```

**响应示例**:
```json
{
  "status": "approving",
  "step": {
    "id": "step-uuid",
    "name": "财务审核",
    "type": "single",
    "status": "in_progress",
    "required_roles": ["finance"],
    "required_signatures": 1,
    "current_approval_count": 0,
    "started_at": 1735689600000
  },
  "actions": [
    {
      "id": "action-uuid",
      "approver": "张三",
      "action": "approve",
      "comment": "同意",
      "time": 1735689700000
    }
  ],
  "is_completed": false,
  "message": "当前步骤: 财务审核"
}
```

#### 6. 获取合同审批时间线
```http
GET /api/contracts/:id/timeline
```

**时间线事件类型**:
- `created` - 合同创建
- `submitted` - 提交审批
- `step_started` - 步骤开始
- `step_completed` - 步骤完成
- `step_rejected` - 步骤驳回
- `action_approve` - 批准
- `action_reject` - 驳回
- `action_request_supplement` - 要求补件
- `action_submit_supplement` - 提交补件
- `archived` - 归档

#### 7. 获取规则命中原因
```http
GET /api/contracts/:id/hit-reason
```

**响应示例**:
```json
{
  "rule_id": "rule-uuid",
  "rule_name": "高风险大额合同",
  "rule_version": 1,
  "hit_reason": [
    "OR: ✓",
    "  amount greater_than_or_equal 1000000: ✓ (actual: 2000000)",
    "  risk_level in [\"high\",\"critical\"]: ✗ (actual: medium)"
  ]
}
```

#### 8. 获取审批意见
```http
GET /api/contracts/:id/comments
```

#### 9. 获取审计日志
```http
GET /api/contracts/:id/audit-logs
```

#### 10. 审批操作
```http
POST /api/contracts/:id/approve
x-user-id: <审批人ID>
Content-Type: application/json

{
  "step_id": "<步骤ID>",
  "action": "approve",
  "comment": "同意，条款清晰",
  "attachments": ["审核意见.pdf"]
}
```

**action 可选值**:
- `approve` - 批准
- `reject` - 驳回
- `reject_all` - 彻底驳回（需重新走流程）
- `request_supplement` - 要求补件

#### 11. 提交补件
```http
POST /api/contracts/:id/supplement
x-user-id: <申请人ID>
Content-Type: application/json

{
  "attachments": [
    {
      "file_name": "补充说明.pdf",
      "file_type": "application/pdf",
      "file_size": 50000
    }
  ],
  "comment": "已补充相关资质证明"
}
```

#### 12. 归档合同
```http
POST /api/contracts/:id/archive
x-user-id: <admin或申请人ID>
```

---

### 二、用户管理

#### 1. 获取当前用户信息
```http
GET /api/users/me
x-user-id: <用户ID>
```

#### 2. 获取我的待办列表
```http
GET /api/users/me/todos
x-user-id: <用户ID>
```

**响应示例**:
```json
[
  {
    "contract_id": "contract-uuid",
    "contract_no": "HT-2025-001",
    "contract_title": "技术服务合同",
    "amount": 500000,
    "currency": "CNY",
    "department": "技术部",
    "risk_level": "medium",
    "applicant_name": "张三",
    "step_id": "step-uuid",
    "step_name": "财务审核",
    "step_type": "single",
    "required_roles": ["finance"],
    "current_approval_count": 0,
    "required_signatures": 1,
    "created_at": 1735689600000,
    "step_started_at": 1735689700000
  }
]
```

#### 3. 获取所有用户
```http
GET /api/users
x-user-id: <用户ID>
```

#### 4. 按用户名查询
```http
GET /api/users/by-username/:username
x-user-id: <用户ID>
```

---

### 三、规则管理

#### 1. 创建规则 (需 admin 角色)
```http
POST /api/rules
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "name": "新合同规则",
  "description": "规则描述",
  "priority": 25,
  "conditions": {
    "type": "composite",
    "logic": "AND",
    "conditions": [
      { "type": "simple", "field": "amount", "operator": "greater_than_or_equal", "value": 50000 },
      { "type": "simple", "field": "risk_level", "operator": "equals", "value": "high" }
    ]
  },
  "steps": [
    { "name": "部门经理审批", "type": "single", "required_roles": ["department_manager"] },
    { "name": "财务审核", "type": "single", "required_roles": ["finance"] }
  ]
}
```

#### 2. 获取所有规则
```http
GET /api/rules
GET /api/rules?active=true
```

#### 3. 获取规则详情
```http
GET /api/rules/:id
GET /api/rules/by-name/:name
GET /api/rules/by-name/:name?version=2
```

#### 4. 停用规则
```http
POST /api/rules/:id/deactivate
x-user-id: <admin用户ID>
```

#### 5. 测试规则匹配
```http
POST /api/rules/match
x-user-id: <用户ID>
Content-Type: application/json

{
  "amount": 2000000,
  "department_id": "<部门ID>",
  "risk_level": "high"
}
```

#### 6. 验证规则步骤
```http
POST /api/rules/validate
x-user-id: <用户ID>
Content-Type: application/json

{
  "steps": [...]
}
```

#### 7. 导出规则 (需 admin 角色)
```http
GET /api/rules/export
x-user-id: <admin用户ID>
```

**curl 示例** (bash / Git Bash / WSL):
```bash
# 导出当前所有活跃规则为 JSON
curl -H "x-user-id: <admin用户ID>" http://localhost:3000/api/rules/export > rules-export.json
```

**PowerShell 示例** (Windows 原生):
```powershell
# 导出当前所有活跃规则为 JSON
$headers = @{ "x-user-id" = "<admin用户ID>" }
Invoke-WebRequest -Uri "http://localhost:3000/api/rules/export" -Headers $headers -OutFile "rules-export.json"
```

> **重要说明**: Windows PowerShell 中的 `curl` 是 `Invoke-WebRequest` 的别名，语法与标准 curl 不同。建议使用上面的 PowerShell 语法，或安装 Git Bash 使用标准 curl。

**响应示例**:
```json
{
  "exported_at": 1735689600000,
  "exported_by": "user-uuid",
  "exported_by_name": "系统管理员",
  "version": "1.0",
  "rules": [
    {
      "name": "中风险中等金额合同",
      "version": 2,
      "description": "规则描述",
      "priority": 50,
      "conditions": { "type": "composite", ... },
      "steps": [ { "name": "部门经理审批", ... } ],
      "effective_from": null,
      "effective_to": null,
      "is_active": 1,
      "created_by": "user-uuid",
      "created_at": 1735000000000
    }
  ]
}
```

#### 8. 导入规则 (需 admin 角色)
```http
POST /api/rules/import
POST /api/rules/import?preview=true
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "rules": [
    {
      "name": "新规则名称",
      "description": "规则描述",
      "priority": 50,
      "conditions": { "type": "composite", ... },
      "steps": [ { "name": "部门经理审批", ... } ]
    }
  ]
}
```

**curl 示例**:
```bash
# 预检模式 - 只显示差异，不落库
curl -H "x-user-id: <admin用户ID>" -H "Content-Type: application/json" \
  -d @rules-export.json \
  "http://localhost:3000/api/rules/import?preview=true"

# 正式导入
curl -H "x-user-id: <admin用户ID>" -H "Content-Type: application/json" \
  -d @rules-export.json \
  http://localhost:3000/api/rules/import
```

**变更类型说明**:
| change_type | 说明 |
|-------------|------|
| `create` | 新增规则 |
| `update` | 生成新版本（有字段变化） |
| `no_change` | 无变化 |
| `priority_conflict` | 优先级冲突 |
| `validation_failed` | 校验失败 |
| `duplicate_name` | 导入文件内重名 |

**预检模式响应示例**:
```json
{
  "preview": true,
  "can_import": true,
  "summary": {
    "create": 1,
    "update": 1,
    "no_change": 1,
    "priority_conflict": 0,
    "validation_failed": 0,
    "duplicate_name": 0
  },
  "total": 3,
  "rules": [
    {
      "index": 0,
      "name": "新规则",
      "change_type": "create",
      "current_version": null,
      "new_version": 1,
      "field_diff": {},
      "validation_errors": [],
      "conflict_details": null,
      "should_audit": true
    },
    {
      "index": 1,
      "name": "中风险中等金额合同",
      "change_type": "update",
      "current_version": 2,
      "new_version": 3,
      "field_diff": {
        "priority": { "old": 20, "new": 25 },
        "description": { "old": "旧描述", "new": "新描述" }
      },
      "validation_errors": [],
      "conflict_details": null,
      "should_audit": true
    },
    {
      "index": 2,
      "name": "低风险小额合同",
      "change_type": "no_change",
      "current_version": 1,
      "new_version": 2,
      "field_diff": {},
      "validation_errors": [],
      "conflict_details": null,
      "should_audit": false
    }
  ],
  "warnings": []
}
```

**优先级冲突响应示例**:
```json
{
  "preview": true,
  "can_import": true,
  "summary": {
    "create": 0,
    "update": 0,
    "no_change": 0,
    "priority_conflict": 1,
    "validation_failed": 0,
    "duplicate_name": 0
  },
  "total": 1,
  "rules": [
    {
      "index": 0,
      "name": "冲突测试规则",
      "change_type": "priority_conflict",
      "current_version": null,
      "new_version": 1,
      "field_diff": {},
      "validation_errors": [],
      "conflict_details": {
        "type": "priority_conflict",
        "conflicting_rule_name": "高风险大额合同",
        "conflicting_rule_id": "rule-uuid",
        "conflicting_priority": 50,
        "message": "优先级 50 与现有规则 \"高风险大额合同\" 冲突，导入后将按版本号排序"
      },
      "should_audit": true
    }
  ],
  "warnings": [
    "优先级 50 与现有规则 \"高风险大额合同\" 冲突，导入后将按版本号排序"
  ]
}
```

**正式导入响应示例**:
```json
{
  "success": true,
  "batch_id": "batch-uuid",
  "imported": 2,
  "skipped": 1,
  "total": 3,
  "summary": {
    "create": 1,
    "update": 1,
    "no_change": 1,
    "priority_conflict": 0,
    "validation_failed": 0,
    "duplicate_name": 0
  },
  "rules": [
    {
      "index": 0,
      "name": "新规则",
      "change_type": "create",
      "current_version": null,
      "new_version": 1,
      "field_diff": {},
      "validation_errors": [],
      "conflict_details": null,
      "should_audit": true
    }
  ],
  "results": [
    {
      "name": "新规则",
      "version": 1,
      "id": "rule-uuid",
      "change_type": "create",
      "previous_active_version": null,
      "field_diff": {}
    },
    {
      "name": "低风险小额合同",
      "version": 1,
      "change_type": "no_change",
      "skipped": true,
      "reason": "无变化，未创建新版本"
    }
  ],
  "warnings": []
}
```

**导入校验项**:
- ✅ JSON 结构校验
- ✅ 角色有效性校验
- ✅ 部门ID有效性校验
- ✅ 优先级冲突检测
- ✅ 重名规则检测
- ✅ 步骤配置完整性校验

**配置项**:
- `RULE_IMPORT_AUDIT_NO_CHANGE=false` - 是否为无变化规则写入审计日志（默认不写，但仍在预检摘要中展示）

#### 9. 获取规则版本列表
```http
GET /api/rules/:name/versions
x-user-id: <用户ID>
```

**curl 示例**:
```bash
curl -H "x-user-id: <用户ID>" \
  http://localhost:3000/api/rules/中风险中等金额合同/versions
```

#### 10. 回滚规则版本 (需 admin 角色)
```http
POST /api/rules/:name/rollback/:version
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "reason": "回滚原因（必填）"
}
```

**curl 示例**:
```bash
curl -H "x-user-id: <admin用户ID>" -H "Content-Type: application/json" \
  -d '{"reason": "新版本存在逻辑错误，回滚到v1"}' \
  http://localhost:3000/api/rules/中风险中等金额合同/rollback/1
```

**响应示例**:
```json
{
  "success": true,
  "message": "规则 \"中风险中等金额合同\" 已回滚到 v1，新版本号 v3",
  "rolled_back_from": 2,
  "rolled_back_to": 1,
  "new_version": 3,
  "rule": { ... }
}
```

---

### 三、规则管理 - 导入批次接口 (需 admin 角色)

#### 1. 获取导入批次列表 (需 admin 角色)
```http
GET /api/rules/batches
GET /api/rules/batches?user_id=<userId>&undo_status=none&limit=50
x-user-id: <admin用户ID>
```

**查询参数**:
- `user_id` - 按操作者筛选
- `undo_status` - 按撤销状态筛选 (`none`, `completed`)
- `limit` - 返回数量限制，默认 100

**curl 示例**:
```bash
curl -H "x-user-id: <admin用户ID>" \
  http://localhost:3000/api/rules/batches?limit=20
```

**响应示例**:
```json
[
  {
    "id": "batch-uuid",
    "user_id": "user-uuid",
    "user_name": "系统管理员",
    "user_username": "admin",
    "created_at": 1735689600000,
    "summary": {
      "create": 2,
      "update": 1,
      "no_change": 1,
      "priority_conflict": 0,
      "validation_failed": 0,
      "duplicate_name": 0
    },
    "config_switches": {
      "auditNoChange": false
    },
    "undo_status": "none",
    "undo_at": null,
    "undo_by": null,
    "undo_by_name": null
  }
]
```

#### 2. 获取批次详情 (需 admin 角色)
```http
GET /api/rules/batches/:id
x-user-id: <admin用户ID>
```

**响应示例**:
```json
{
  "id": "batch-uuid",
  "user_id": "user-uuid",
  "user_name": "系统管理员",
  "user_username": "admin",
  "created_at": 1735689600000,
  "summary": {
    "create": 2,
    "update": 1,
    "no_change": 1
  },
  "rules_summary": [
    {
      "index": 0,
      "name": "新规则",
      "change_type": "create",
      "current_version": null,
      "new_version": 1,
      "field_diff": {},
      "should_audit": true
    },
    {
      "index": 1,
      "name": "中风险中等金额合同",
      "change_type": "update",
      "current_version": 2,
      "new_version": 3,
      "field_diff": {
        "priority": { "old": 20, "new": 25 }
      },
      "should_audit": true
    }
  ],
  "results": [
    {
      "name": "新规则",
      "version": 1,
      "id": "rule-uuid",
      "change_type": "create",
      "previous_active_version": null,
      "field_diff": {}
    }
  ],
  "config_switches": {
    "auditNoChange": false
  },
  "undo_status": "none",
  "undo_at": null,
  "undo_by": null,
  "undo_by_name": null,
  "undo_results": null
}
```

#### 3. 撤销导入批次 (需 admin 角色)
```http
POST /api/rules/batches/:id/undo
x-user-id: <admin用户ID>
```

**撤销逻辑**:
- **新增规则** (`create` / `priority_conflict`): 停用该规则版本
- **更新规则** (`update`): 停用当前版本，基于上一活跃版本内容创建新版本（保持版本历史完整）
- **无变化** (`no_change`): 记录跳过，不做操作
- **校验失败/重名** (`validation_failed` / `duplicate_name`): 记录跳过，未实际导入

**curl 示例**:
```bash
curl -H "x-user-id: <admin用户ID>" -X POST \
  http://localhost:3000/api/rules/batches/<batchId>/undo
```

**响应示例**:
```json
{
  "success": true,
  "batch_id": "batch-uuid",
  "undo_results": [
    {
      "name": "新规则",
      "change_type": "create",
      "undo_action": "deactivated",
      "version": 1,
      "message": "新增规则已停用"
    },
    {
      "name": "中风险中等金额合同",
      "change_type": "update",
      "undo_action": "reverted",
      "deactivated_version": 3,
      "reactivated_version": 4,
      "based_on_version": 2,
      "message": "已切回 v2 内容并创建新版本 v4"
    },
    {
      "name": "无变化规则",
      "change_type": "no_change",
      "undo_action": "skipped",
      "reason": "无变化规则，跳过"
    }
  ],
  "summary": {
    "deactivated": 1,
    "reverted": 1,
    "skipped": 1,
    "total": 3
  }
}
```

**撤销状态说明**:
| undo_status | 说明 |
|-------------|------|
| `none` | 未撤销 |
| `completed` | 已完成撤销 |

---

### 四、规则管理 - 高级接口

#### 1. 全局审计日志 (需 admin 角色)
```http
GET /api/users/audit-logs
GET /api/users/audit-logs?limit=50
x-user-id: <admin用户ID>
```

**curl 示例** (bash / Git Bash / WSL):
```bash
curl -H "x-user-id: <admin用户ID>" \
  "http://localhost:3000/api/users/audit-logs?limit=100"
```

**PowerShell 示例** (Windows 原生):
```powershell
$headers = @{ "x-user-id" = "<admin用户ID>" }
Invoke-WebRequest -Uri "http://localhost:3000/api/users/audit-logs?limit=100" -Headers $headers
```

#### 2. 持久性检查 (需 admin 角色)
```http
GET /api/users/persistence-check
x-user-id: <admin用户ID>
```

**curl 示例** (bash / Git Bash / WSL):
```bash
curl -H "x-user-id: <admin用户ID>" \
  http://localhost:3000/api/users/persistence-check
```

**PowerShell 示例** (Windows 原生):
```powershell
$headers = @{ "x-user-id" = "<admin用户ID>" }
Invoke-WebRequest -Uri "http://localhost:3000/api/users/persistence-check" -Headers $headers
```

**响应示例**:
```json
{
  "status": "ok",
  "timestamp": 1735689600000,
  "checks": {
    "db_file_exists": true,
    "db_file_size": 102400,
    "tables_present": 8,
    "users_count": 10,
    "rules_count": 5,
    "contracts_count": 20,
    "save_consistent": true,
    "last_save_timeout": true,
    "pending_transactions": 0
  },
  "message": "所有持久性检查通过"
}
```

---

### 四、部门管理

#### 1. 创建部门 (需 admin)
```http
POST /api/departments
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "name": "采购部",
  "code": "PUR"
}
```

#### 2. 获取所有部门
```http
GET /api/departments
```

#### 3. 按编码查询
```http
GET /api/departments/by-code/:code
```

---

### 五、归档管理

#### 1. 获取所有归档
```http
GET /api/archives
```

#### 2. 获取归档内容
```http
GET /api/archives/:archiveNo/content
```

**包含**: 合同、规则、所有审批步骤、审批意见、附件、审计日志

#### 3. 验证归档完整性
```http
GET /api/archives/:archiveNo/verify
```

**响应示例**:
```json
{
  "valid": true,
  "expected_hash": "abc123...",
  "actual_hash": "abc123..."
}
```

#### 4. 按合同查询归档
```http
GET /api/archives/by-contract/:contractId
```

---

### 六、SLA配置管理 (需 admin 角色)

SLA（服务水平协议）配置用于定义不同合同的审批时限规则。系统会根据合同的风险等级、金额、部门等属性自动匹配最适合的SLA配置。

#### 1. 获取所有SLA配置
```http
GET /api/sla
GET /api/sla?active_only=true
x-user-id: <用户ID>
```

**查询参数**:
- `active_only` - 只返回激活状态的配置

#### 2. 获取SLA配置详情
```http
GET /api/sla/:id
x-user-id: <用户ID>
```

#### 3. 创建SLA配置 (需 admin 角色)
```http
POST /api/sla
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "name": "高风险大额合同SLA",
  "risk_level": "high",
  "department_id": null,
  "min_amount": 1000000,
  "max_amount": null,
  "step_name": null,
  "deadline_hours": 24,
  "first_reminder_hours": 12,
  "second_reminder_hours": 18,
  "escalation_hours": 30,
  "escalation_roles": ["admin"],
  "priority": 100,
  "is_active": true
}
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | SLA名称，必填 |
| `risk_level` | string | 风险等级：low/medium/high/critical，null表示通用 |
| `department_id` | string | 部门ID，null表示通用 |
| `min_amount` | number | 最低金额，null表示不限 |
| `max_amount` | number | 最高金额，null表示不限 |
| `step_name` | string | 步骤名称，null表示通用 |
| `deadline_hours` | number | 审批时限（小时），必填 |
| `first_reminder_hours` | number | 首次催办时间（小时），需小于deadline_hours |
| `second_reminder_hours` | number | 二次催办时间（小时），需大于first_reminder_hours |
| `escalation_hours` | number | 升级时间（小时），需大于deadline_hours |
| `escalation_roles` | array | 升级通知角色，escalation_hours设置时必填 |
| `priority` | number | 优先级，数值越大优先级越高 |
| `is_active` | boolean | 是否激活 |

**SLA匹配规则**:
- 系统按priority从高到低匹配所有激活的SLA配置
- 最具体的规则（指定了最多匹配条件）优先于通用规则
- 每个审批步骤只会匹配一个SLA配置

#### 4. 更新SLA配置 (需 admin 角色)
```http
PUT /api/sla/:id
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "name": "更新后的SLA名称",
  "deadline_hours": 48
}
```

#### 5. 停用SLA配置 (需 admin 角色)
```http
POST /api/sla/:id/deactivate
x-user-id: <admin用户ID>
```

#### 6. 激活SLA配置 (需 admin 角色)
```http
POST /api/sla/:id/activate
x-user-id: <admin用户ID>
```

#### 7. 删除SLA配置 (需 admin 角色)
```http
DELETE /api/sla/:id
x-user-id: <admin用户ID>
```

#### 8. 验证SLA配置
```http
POST /api/sla/validate
x-user-id: <用户ID>
Content-Type: application/json

{
  "name": "测试SLA",
  "deadline_hours": 24,
  "first_reminder_hours": 12
}
```

**响应示例**:
```json
{
  "valid": false,
  "errors": [
    "first_reminder_hours 必须小于 deadline_hours",
    "设置 escalation_hours 时必须同时设置 escalation_roles"
  ]
}
```

#### 9. 测试SLA匹配
```http
POST /api/sla/match
x-user-id: <用户ID>
Content-Type: application/json

{
  "contract": {
    "amount": 2000000,
    "department_id": "<部门ID>",
    "risk_level": "high"
  },
  "step_name": "财务审核"
}
```

**响应示例**:
```json
{
  "matches": [
    { "id": "sla-1", "name": "高风险大额合同SLA", "priority": 100 },
    { "id": "sla-2", "name": "通用SLA", "priority": 0 }
  ],
  "best_match": {
    "id": "sla-1",
    "name": "高风险大额合同SLA",
    "deadline_hours": 24,
    "first_reminder_hours": 12
  }
}
```

---

### 七、时限管理

时限记录跟踪每个审批步骤的截止时间、催办状态和升级情况。

#### 1. 获取我的待办时限列表
```http
GET /api/deadlines/my
GET /api/deadlines/my?overdue_only=true
GET /api/deadlines/my?due_soon_hours=24
GET /api/deadlines/my?status=active
x-user-id: <用户ID>
```

**查询参数**:
- `overdue_only` - 只返回已超时的时限
- `due_soon_hours` - 只返回指定小时内即将到期的时限
- `status` - 按状态筛选：active/paused/completed/closed

**响应示例**:
```json
[
  {
    "id": "deadline-uuid",
    "contract_id": "contract-uuid",
    "contract_no": "HT-2025-001",
    "contract_title": "技术服务合同",
    "step_id": "step-uuid",
    "step_name": "财务审核",
    "approver_roles": ["finance"],
    "deadline_hours": 24,
    "deadline_at": 1735776000000,
    "first_reminder_at": 1735732800000,
    "first_reminder_sent": true,
    "second_reminder_at": 1735754400000,
    "second_reminder_sent": false,
    "escalation_at": 1735797600000,
    "escalation_sent": false,
    "status": "active",
    "is_overdue": false,
    "remaining_hours": 12.5,
    "started_at": 1735689600000,
    "sla_config_name": "高风险大额合同SLA"
  }
]
```

#### 2. 获取我的超时列表
```http
GET /api/deadlines/my/overdue
x-user-id: <用户ID>
```

#### 3. 获取我的即将超时列表
```http
GET /api/deadlines/my/due-soon
GET /api/deadlines/my/due-soon?hours=48
x-user-id: <用户ID>
```

#### 4. 获取所有时限列表 (需 admin 角色)
```http
GET /api/deadlines
GET /api/deadlines?status=active
GET /api/deadlines?contract_id=<合同ID>
GET /api/deadlines?is_overdue=true
x-user-id: <admin用户ID>
```

**查询参数**:
- `status` - 按状态筛选
- `contract_id` - 按合同筛选
- `is_overdue` - 只返回已超时的

#### 5. 获取所有超时列表 (需 admin 角色)
```http
GET /api/deadlines/overdue
x-user-id: <admin用户ID>
```

#### 6. 获取时限详情
```http
GET /api/deadlines/:id
x-user-id: <用户ID>
```

**权限说明**:
- admin可查看所有时限
- 普通用户只能查看自己角色相关的时限

#### 7. 暂停时限 (需 admin 角色)
暂停后自动催办和升级将停止，直到恢复。

```http
POST /api/deadlines/:id/pause
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "reason": "假期暂停审批"
}
```

#### 8. 恢复时限 (需 admin 角色)
```http
POST /api/deadlines/:id/resume
x-user-id: <admin用户ID>
```

#### 9. 手动催办 (需 admin 角色)
```http
POST /api/deadlines/:id/remind
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "reason": "请尽快处理此合同"
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "催办通知已发送",
  "deadline": { ... }
}
```

#### 10. 重新计算时限 (需 admin 角色)
当SLA配置变更时，可重新计算某条时限的截止时间。旧时限会被关闭，新时限会创建。

```http
POST /api/deadlines/:id/recalculate
x-user-id: <admin用户ID>
Content-Type: application/json

{
  "reason": "应用新的SLA配置"
}
```

**响应示例**:
```json
{
  "old_deadline": { "id": "old-uuid", "status": "closed", ... },
  "new_deadline": { "id": "new-uuid", "status": "active", "deadline_hours": 12, ... }
}
```

#### 11. 获取时限审计日志
```http
GET /api/deadlines/:id/audit-logs
x-user-id: <用户ID>
```

**审计日志操作类型**:
- `created` - 时限创建
- `paused` - 暂停
- `resumed` - 恢复
- `manual_reminder` - 手动催办
- `first_reminder` - 首次自动催办
- `second_reminder` - 二次自动催办
- `escalation` - 升级通知
- `completed` - 步骤完成
- `closed` - 关闭（补件/驳回/归档等）
- `recalculated` - 重新计算

**响应示例**:
```json
[
  {
    "id": "log-uuid",
    "action": "paused",
    "user_id": "user-uuid",
    "user_name": "系统管理员",
    "reason": "假期暂停审批",
    "old_status": "active",
    "new_status": "paused",
    "ip_address": "127.0.0.1",
    "created_at": 1735689600000
  }
]
```

#### 12. 按合同查询时限
```http
GET /api/deadlines/contract/:contractId
x-user-id: <用户ID>
```

#### 13. 手动触发催办处理 (需 admin 角色)
```http
POST /api/deadlines/process-reminders
x-user-id: <admin用户ID>
```

**响应示例**:
```json
{
  "success": true,
  "results": {
    "first_reminders": ["deadline-1", "deadline-2"],
    "second_reminders": [],
    "escalations": []
  },
  "message": "处理完成：首次催办 2 条，二次催办 0 条，升级 0 条"
}
```

#### 14. 获取定时任务状态 (需 admin 角色)
```http
GET /api/deadlines/scheduler/status
x-user-id: <admin用户ID>
```

**响应示例**:
```json
{
  "running": true,
  "interval_minutes": 1,
  "last_run_at": 1735689600000,
  "next_run_at": 1735689660000,
  "total_runs": 125,
  "total_reminders_sent": 45
}
```

#### 15. 手动触发定时任务 (需 admin 角色)
```http
POST /api/deadlines/scheduler/trigger
x-user-id: <admin用户ID>
```

---

## 合同状态流转

```
draft (草稿)
    ↓ 提交审批 (需附件)
approving (审批中)
    ├─→ request_supplement (要求补件) → 提交补件 → approving
    ├─→ rejected (驳回) → 修改后可重新提交
    └─→ 所有步骤完成 → approved (已批准)
                            ↓ 归档
                         archived (已归档)
```

## 审批步骤类型

| 类型 | 说明 |
|------|------|
| single | 单人审批，指定角色中任意一人审批即可 |
| any | 多人任选，指定角色中任意一人审批即可 |
| countersign | 会签，需要达到 required_signatures 人数 |

---

## 错误码说明

| HTTP 状态码 | 说明 |
|------------|------|
| 400 | 参数错误或业务逻辑错误（如缺附件、重复审批、越权等） |
| 401 | 未认证（缺少 x-user-id） |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

---

## 常见错误消息

| 错误消息 | 原因 | 解决方法 |
|----------|------|----------|
| 缺少必要附件 | 提交时没有必要附件 | 先上传至少一份必要附件 |
| 越权操作 | 审批人没有对应角色 | 使用具有相应角色的用户ID |
| 申请人不能审批自己提交的合同 | 申请人尝试审批 | 使用其他用户审批 |
| 您已对此步骤进行过审批 | 重复审批 | 等待其他审批人操作 |
| 步骤 [xxx] 已完成，重复提交 | 步骤已完成 | 进入下一步或归档 |
| 没有匹配的审批规则 | 合同属性不匹配任何规则 | 检查规则配置或调整合同属性 |
| 合同状态 [xxx] 不允许提交 | 状态错误 | 确保是 draft 或 supplement_requested 状态 |

---

## 回归测试

### 测试脚本说明

| 测试脚本 | 说明 |
|----------|------|
| `tests/test-rules-import-export.js` | 规则导入导出回滚完整回归测试 |
| `tests/test-persistence-restart.js` | 跨服务重启持久性验证测试 |

### 运行测试

#### 1. 完整回归测试
```bash
# 确保服务已启动
npm start

# 运行完整回归测试（需要先运行 npm run seed 初始化数据）
node tests/test-rules-import-export.js
```

#### 2. 跨服务重启持久性测试
```bash
# 先运行第一部分测试
node tests/test-rules-import-export.js

# 测试完成后，重启服务（Ctrl+C 然后 npm start）

# 使用测试输出的参数运行持久性测试
node tests/test-persistence-restart.js <contractId> <ruleName>
```

### 测试覆盖范围

✅ **权限测试**
- 普通用户不能导出/导入/回滚规则
- 普通用户不能查看全局审计日志
- 普通用户看不到审计日志敏感字段

✅ **导出测试**
- 导出 JSON 包含所有必要字段（条件、步骤、优先级、版本）
- 导出格式版本标记

✅ **导入测试**
- 预检模式（preview=true）只返回差异，不落库
- 结构校验（JSON Schema）
- 角色有效性校验
- 部门ID有效性校验
- 优先级冲突检测
- 重名规则检测
- 保留旧版本，创建新版本
- 写审计日志

✅ **回滚测试**
- 回滚原因必填
- 记录操作者和原因
- 创建新版本号（不修改历史）
- 新提交合同使用回滚后的规则
- 审批中合同不受影响

✅ **一致性测试**
- 导出再导入数据一致性
- 审批中合同不受规则变更影响
- 新提交合同使用最新规则版本

✅ **持久性测试**
- 跨服务重启数据完整
- 内存与文件数据一致
- 版本历史完整保留

---

## 重要设计约定

### 规则版本管理
1. **永不修改历史版本**：每次导入或回滚都创建新版本
2. **审批中合同不受影响**：合同提交时绑定规则ID和版本，后续规则变更不影响已在审批中的合同
3. **新合同使用最新规则**：新提交的合同始终匹配当前活跃的最新版本规则

### 审计日志
1. **所有敏感操作留痕**：导出、导入、回滚都写入审计日志
2. **权限隔离**：普通用户看不到变更前后的具体值和IP地址
3. **回滚原因强制记录**：回滚操作必须填写原因，永久留存

### 数据持久化
1. **立即持久化**：导入和回滚操作调用 `forceSave()` 立即写入磁盘
2. **一致性校验**：提供 `/api/users/persistence-check` 接口验证数据完整性
3. **原子操作**：所有数据库操作通过事务队列保证一致性
