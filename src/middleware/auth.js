const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
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
      // Use the fixed secret for verification
      const decoded = jwt.verify(token, 'sharing_service_secret_key_2024');
      console.log('Decoded token:', decoded);

      // Get user to verify token matches stored token
      const user = await User.getById(decoded.id);
      console.log('User from DB:', user);

      if (!user || user.current_token !== token) {
        return res.status(401).json({ error: 'Token is invalid or expired' });
      }

      req.user = {
        id: decoded.id,
        email: decoded.email,
        isTasker: decoded.isTasker || false,
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

module.exports = auth;
