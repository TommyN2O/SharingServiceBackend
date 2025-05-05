const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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
    // Read the SQL file
    const sqlFile = path.join(__dirname, 'init-db.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Execute the SQL
    await appPool.query(sql);
    console.log('Database initialized successfully');

    // Insert test user if it doesn't exist
    await appPool.query(`
      INSERT INTO users (name, surname, email, password_hash, is_tasker)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `, ['Test', 'User', 'test@example.com', 'test_hash', true]);

    console.log('Test data inserted successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    await appPool.end();
  }
}

// Run the initialization
initializeDatabase();
