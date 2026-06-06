const User = require('../models/User');

function authMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(401).json({ error: '未提供用户ID，请在请求头中设置 x-user-id' });
  }
  
  const user = User.findById(userId);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  
  if (!user.is_active) {
    return res.status(403).json({ error: '用户已被禁用' });
  }
  
  req.user = user;
  req.ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  
  next();
}

module.exports = authMiddleware;
