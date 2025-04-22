const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      // Use the fixed secret for verification
      const decoded = jwt.verify(token, 'sharing_service_secret_key_2024');
      
      // Get user to verify token matches stored token
      const user = await User.getById(decoded.id);

      if (!user || user.current_token !== token) {
        return res.status(401).json({ error: 'Token is invalid or expired' });
      }

      req.user = {
        id: decoded.id,
        email: decoded.email,
        isTasker: decoded.isTasker || false
      };

      next();
    } catch (error) {
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