const express = require('express');
const cors = require('./config/corsConfig');
const routes = require('./routes');
const requestLogger = require('./middleware/requestLogger');
const path = require('path');
const Category = require('./models/Category');
const TaskerProfile = require('./models/TaskerProfile');
const pool = require('./config/database');
const City = require('./models/City');
const authRoutes = require('./routes/authRoutes');
const taskerRoutes = require('./routes/taskerRoutes');
const messageRoutes = require('./routes/messageRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

// Middleware
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payment/webhook') {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors);
app.use(requestLogger);

// Serve static files from the public/images directory
app.use('/images', express.static(path.join(__dirname, '../public/images')));

// Add a route to check image paths
app.get('/check-image-paths', (req, res) => {
  const paths = {
    imagesDir: path.join(__dirname, '../public/images')
  };
  res.json({ paths });
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        surname VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        date_of_birth DATE,
        is_tasker BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table initialized');

    // Create cities table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Cities table initialized');

    // Create tasker_profiles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasker_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        profile_photo VARCHAR(255),
        description TEXT,
        hourly_rate DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Tasker profiles table initialized');

    // Create tasker_cities table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasker_cities (
        tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
        city_id INTEGER REFERENCES cities(id) ON DELETE CASCADE,
        PRIMARY KEY (tasker_id, city_id)
      )
    `);
    console.log('Tasker cities table initialized');

    // Create customer_requests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        category_id INTEGER REFERENCES categories(id),
        description TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Customer requests table initialized successfully');

    // Create tasker_categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasker_categories (
        tasker_id INTEGER REFERENCES tasker_profiles(id),
        category_id INTEGER REFERENCES categories(id),
        PRIMARY KEY (tasker_id, category_id)
      )
    `);
    console.log('Tasker categories table initialized successfully');

    // Create tasker_availability table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasker_availability (
        id SERIAL PRIMARY KEY,
        tasker_id INTEGER REFERENCES tasker_profiles(id),
        date DATE,
        time_slot TIME,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tasker_id, date, time_slot)
      )
    `);
    console.log('Tasker availability table initialized successfully');

    // Create tasker_gallery table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasker_gallery (
        id SERIAL PRIMARY KEY,
        tasker_id INTEGER REFERENCES tasker_profiles(id),
        image_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Tasker gallery table initialized successfully');

    // Create planned_tasks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS planned_tasks (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES users(id),
        tasker_id INTEGER REFERENCES users(id),
        category_id INTEGER REFERENCES categories(id),
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Planned tasks table initialized successfully');

    // Create reviews table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        planned_task_id INTEGER REFERENCES planned_tasks(id),
        tasker_id INTEGER REFERENCES users(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Reviews table initialized successfully');

    // Create saved_taskers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_taskers (
        customer_id INTEGER REFERENCES users(id),
        tasker_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (customer_id, tasker_id)
      )
    `);
    console.log('Saved taskers table initialized successfully');

    // Initialize category table
    await Category.createCategoryTable();
    console.log('Category table initialized successfully');
  } catch (error) {
    console.error('Error initializing database tables:', error);
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
      users: '/api/users',
      category: '/api/category',
      tasker: '/api/tasker',
      tasks: '/api/tasks'
    }
  });
});

// Routes
app.use('/api', routes);
app.use('/api/cities', require('./routes/cityRoutes'));
app.use('/api/auth', authRoutes);
app.use('/api/tasker', taskerRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/payment', paymentRoutes);

// Special handling for Stripe webhook route
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Regular JSON parsing for all other routes
app.use(express.json());

// Initialize Lithuanian cities
app.get('/api/init-cities', async (req, res) => {
  try {
    console.log('Starting cities initialization...');
    await City.initializeLithuanianCities();
    console.log('Cities initialization completed');
    res.json({ message: 'Lithuanian cities initialized successfully' });
  } catch (error) {
    console.error('Error initializing cities:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all cities
app.get('/api/cities', async (req, res) => {
  try {
    console.log('Fetching all cities...');
    const cities = await City.getAll();
    console.log('Cities fetched:', cities);
    res.json(cities);
  } catch (error) {
    console.error('Error getting cities:', error);
    res.status(500).json({ error: error.message });
  }
});

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