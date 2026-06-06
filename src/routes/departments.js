const express = require('express');
const Joi = require('joi');
const Department = require('../models/Department');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const createDeptSchema = Joi.object({
  name: Joi.string().required(),
  code: Joi.string().required(),
  parent_id: Joi.string()
});

router.post('/', (req, res) => {
  try {
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({ error: '只有管理员可以创建部门' });
    }
    
    const { error, value } = createDeptSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const dept = Department.create(value);
    res.status(201).json(dept);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '部门名称或编码已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const depts = Department.findAll();
  res.json(depts);
});

router.get('/:id', (req, res) => {
  const dept = Department.findById(req.params.id);
  if (!dept) {
    return res.status(404).json({ error: '部门不存在' });
  }
  res.json(dept);
});

router.get('/by-code/:code', (req, res) => {
  const dept = Department.findByCode(req.params.code);
  if (!dept) {
    return res.status(404).json({ error: '部门不存在' });
  }
  res.json(dept);
});

module.exports = router;
