const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/jwt');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    console.log('Auth header:', authHeader);

    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('Token:', token);

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('Decoded token:', decoded);

      // Get user to verify token matches stored token
      const user = await User.getById(decoded.userId);
      console.log('User from DB:', user);

      if (!user || user.current_token !== token) {
        return res.status(401).json({ error: 'Token is invalid or expired' });
      }

      req.user = {
        id: decoded.userId,
        email: user.email,
        isTasker: user.is_tasker || false,
      };
      console.log('Set user in request:', req.user);

      next();
    } catch (error) {
      console.error('Token verification error:', error);
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token has expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

const isTasker = (req, res, next) => {
  if (!req.user || !req.user.isTasker) {
    return res.status(403).json({ error: 'Access denied. Only taskers can perform this action.' });
  }
  next();
};

module.exports = {
  authenticateToken,
  isTasker
};
