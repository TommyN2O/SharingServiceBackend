const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const categoryRoutes = require('./categoryRoutes');
const taskerRoutes = require('./taskerRoutes');

// Root route
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Welcome to the Task Sharing Service API',
    version: '1.0.0',
    endpoints: {
      test: '/api/test',
      auth: '/api/auth',
      users: '/api/users',
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
router.use('/users', userRoutes);

// Category routes
router.use('/category', categoryRoutes);

// Tasker routes
router.use('/tasker', taskerRoutes);

// Server date route
router.get('/serverdate', (req, res) => {
  res.status(200).json({
    date: new Date().toISOString()
  });
});

module.exports = router; 