const { Pool } = require('pg');
require('dotenv').config();

// First connect to default postgres database to create our database
const defaultPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: 'postgres',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Then connect to our application database
const appPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function initializeDatabase() {
  try {
    // Create database if it doesn't exist
    await defaultPool.query(`CREATE DATABASE ${process.env.DB_NAME}`);
    console.log('Database created successfully');

    // Create tables
    await appPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        surname VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        date_of_birth DATE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        image_url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasker_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        profile_image TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        available_cities TEXT[] NOT NULL,
        available_time JSONB NOT NULL,
        gallery_images TEXT[],
        category_ids INT[] NOT NULL,
        can_take_tasks BOOLEAN DEFAULT TRUE,
        review_count INT DEFAULT 0,
        rating DECIMAL(3,2) DEFAULT 0 CHECK (rating BETWEEN 0 AND 5)
      );

      CREATE TABLE IF NOT EXISTS tasker_gallery (
        id SERIAL PRIMARY KEY,
        tasker_id INT REFERENCES tasker_profiles(id) ON DELETE CASCADE,
        image_path TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customer_requests (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        profile_image TEXT NOT NULL,
        city VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        budget DECIMAL(10,2) NOT NULL,
        due_date DATE NOT NULL,
        gallery_images TEXT[],
        needed_time JSONB NOT NULL,
        category_id INT REFERENCES categories(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customer_request_offers (
        id SERIAL PRIMARY KEY,
        request_id INT REFERENCES customer_requests(id) ON DELETE CASCADE,
        tasker_id INT REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        suggest_date DATE NOT NULL,
        suggest_time JSONB NOT NULL,
        status VARCHAR(20) CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS planned_tasks (
        id SERIAL PRIMARY KEY,
        request_id INT REFERENCES customer_requests(id) ON DELETE CASCADE,
        tasker_id INT REFERENCES users(id) ON DELETE CASCADE,
        customer_id INT REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        location VARCHAR(255) NOT NULL,
        task_images TEXT[],
        date DATE NOT NULL,
        time JSONB NOT NULL,
        tasker_accepted BOOLEAN DEFAULT FALSE,
        customer_accepted BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        planned_task_id INT REFERENCES planned_tasks(id) ON DELETE CASCADE,
        tasker_id INT REFERENCES users(id) ON DELETE CASCADE,
        customer_id INT REFERENCES users(id) ON DELETE CASCADE,
        assigned_date DATE NOT NULL,
        assigned_time JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        planned_task_id INT REFERENCES planned_tasks(id) ON DELETE CASCADE,
        reviewer_id INT REFERENCES users(id) ON DELETE CASCADE,
        reviewee_id INT REFERENCES users(id) ON DELETE CASCADE,
        rating INT CHECK (rating BETWEEN 1 AND 5),
        review TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        planned_task_id INT REFERENCES planned_tasks(id) ON DELETE CASCADE,
        customer_id INT REFERENCES users(id) ON DELETE CASCADE,
        tasker_id INT REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) CHECK (status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
        transaction_date TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INT REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        seen BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS saved_taskers (
        id SERIAL PRIMARY KEY,
        customer_id INT REFERENCES users(id) ON DELETE CASCADE,
        tasker_id INT REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS task_history (
        id SERIAL PRIMARY KEY,
        customer_id INT REFERENCES users(id) ON DELETE CASCADE,
        tasker_id INT REFERENCES users(id) ON DELETE CASCADE,
        task_id INT REFERENCES planned_tasks(id) ON DELETE CASCADE,
        status VARCHAR(20) CHECK (status IN ('completed', 'cancelled', 'in_progress')) DEFAULT 'completed',
        completed_at TIMESTAMP DEFAULT NOW()
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_tasker_profiles_user_id ON tasker_profiles(user_id);
      CREATE INDEX IF NOT EXISTS idx_customer_requests_user_id ON customer_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_customer_requests_category ON customer_requests(category_id);
      CREATE INDEX IF NOT EXISTS idx_customer_request_offers_request ON customer_request_offers(request_id);
      CREATE INDEX IF NOT EXISTS idx_planned_tasks_request ON planned_tasks(request_id);
      CREATE INDEX IF NOT EXISTS idx_payments_task ON payments(planned_task_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_saved_taskers_customer ON saved_taskers(customer_id);
      CREATE INDEX IF NOT EXISTS idx_task_history_customer ON task_history(customer_id);
      CREATE INDEX IF NOT EXISTS idx_task_history_tasker ON task_history(tasker_id);
      CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
    `);
    console.log('Tables created successfully');

    // Close connections
    await defaultPool.end();
    await appPool.end();
    console.log('Database initialization completed');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initializeDatabase(); 