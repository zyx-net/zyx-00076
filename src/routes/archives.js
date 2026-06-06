const express = require('express');
const Archive = require('../models/Archive');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const archives = Archive.findAll();
  res.json(archives);
});

router.get('/:id', (req, res) => {
  const archive = Archive.findById(req.params.id);
  if (!archive) {
    return res.status(404).json({ error: '归档不存在' });
  }
  res.json(archive);
});

router.get('/by-contract/:contractId', (req, res) => {
  const archive = Archive.findByContract(req.params.contractId);
  if (!archive) {
    return res.status(404).json({ error: '该合同没有归档记录' });
  }
  res.json(archive);
});

router.get('/by-no/:archiveNo', (req, res) => {
  const archive = Archive.findByNo(req.params.archiveNo);
  if (!archive) {
    return res.status(404).json({ error: '归档不存在' });
  }
  res.json(archive);
});

router.get('/:archiveNo/content', (req, res) => {
  const content = Archive.loadContent(req.params.archiveNo);
  if (!content) {
    return res.status(404).json({ error: '归档不存在或文件已损坏' });
  }
  res.json(content);
});

router.get('/:archiveNo/verify', (req, res) => {
  const result = Archive.verify(req.params.archiveNo);
  res.json(result);
});

module.exports = router;
