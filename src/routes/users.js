const express = require('express');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const ContractApprovalService = require('../services/ContractApprovalService');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const users = User.findAll();
  res.json(users);
});

router.get('/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

router.get('/me/todos', authMiddleware, (req, res) => {
  const todos = ContractApprovalService.getTodoList(req.user.id);
  res.json(todos);
});

router.get('/audit-logs', authMiddleware, (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以查看全局审计日志' });
    }
    const { limit } = req.query;
    const logs = AuditLog.findAll(parseInt(limit) || 100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/persistence-check', authMiddleware, (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以执行持久性检查' });
    }
    
    const db = require('../database/db');
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.resolve(__dirname, '../../data/db.json');
    
    const beforeData = JSON.stringify(db.data);
    db.forceSave();
    const savedData = fs.readFileSync(dbPath, 'utf8');
    const parsedSaved = JSON.parse(savedData);
    
    const checks = {
      db_file_exists: fs.existsSync(dbPath),
      db_file_size: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
      tables_present: Object.keys(db.data).length,
      users_count: db.data.users?.length || 0,
      rules_count: db.data.approval_rules?.length || 0,
      contracts_count: db.data.contracts?.length || 0,
      save_consistent: JSON.stringify(parsedSaved) === JSON.stringify(db.data),
      last_save_timeout: db.saveTimeout === null,
      pending_transactions: db.transactionQueue?.length || 0
    };
    
    const allGood = checks.db_file_exists && checks.save_consistent && checks.last_save_timeout && checks.pending_transactions === 0;
    
    res.json({
      status: allGood ? 'ok' : 'warning',
      timestamp: Date.now(),
      checks,
      message: allGood ? '所有持久性检查通过' : '部分检查未通过，请查看详情'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-username/:username', authMiddleware, (req, res) => {
  const user = User.findByUsername(req.params.username);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

router.get('/:id', authMiddleware, (req, res) => {
  const user = User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

module.exports = router;
