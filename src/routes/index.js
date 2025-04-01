const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const categoryRoutes = require('./categoryRoutes');

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
      category: '/api/category',
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
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      connected: true,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME
    }
  });
});

// Auth routes
router.use('/auth', authRoutes);

// User routes
router.use('/user', userRoutes);

// Category routes
router.use('/category', categoryRoutes);

module.exports = router; 