const express = require('express');
const User = require('../models/User');
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

router.get('/:id', authMiddleware, (req, res) => {
  const user = User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

router.get('/by-username/:username', authMiddleware, (req, res) => {
  const user = User.findByUsername(req.params.username);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

module.exports = router;
