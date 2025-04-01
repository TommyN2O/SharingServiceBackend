const express = require('express');
const cors = require('./config/corsConfig');
const routes = require('./routes');
const requestLogger = require('./middleware/requestLogger');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors);
app.use(requestLogger);

// Root route
app.get('/', (req, res) => {
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

// API routes
app.use('/api', routes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = app; 