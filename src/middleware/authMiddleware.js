const jwt = require('jsonwebtoken');
const pool = require('../config/database');
require('dotenv').config();

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_key_here');

    // Check if user exists and token is valid
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id, email, name, surname, current_token FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }

      const user = result.rows[0];

      // Optional: Check if token matches the stored token
      if (user.current_token !== token) {
        return res.status(401).json({ error: 'Token is no longer valid' });
      }

      // Add user info to request
      req.user = user;
      next();
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = authMiddleware; 