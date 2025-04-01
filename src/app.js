const express = require('express');
const cors = require('./config/corsConfig');
const routes = require('./routes');
const requestLogger = require('./middleware/requestLogger');
const path = require('path');
const Category = require('./models/Category');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors);
app.use(requestLogger);

// Serve static files from the Images directory
app.use('/images/categories', express.static(path.join(__dirname, '../../Images/Categorys')));

// Initialize database tables
async function initializeDatabase() {
  try {
    await Category.createCategoryTable();
    console.log('Category table initialized successfully');
  } catch (error) {
    console.error('Error initializing category table:', error);
  }
}

// Initialize database when app starts
initializeDatabase();

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
      category: '/api/category',
      tasker: '/api/tasker',
      tasks: '/api/tasks'
    }
  });
});

// Routes
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