const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');

// Root route
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Welcome to the Task Sharing Service API',
    version: '1.0.0',
    endpoints: {
      test: '/api/test',
      auth: '/api/auth',
      user: '/api/user',
      tasker: '/api/tasker',
      tasks: '/api/tasks'
    }
  });
});

// Test route
router.get('/test', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API is working correctly!',
    timestamp: new Date().toISOString()
  });
});

// Auth routes
router.use('/auth', authRoutes);

// User routes
router.use('/user', userRoutes);

module.exports = router; 