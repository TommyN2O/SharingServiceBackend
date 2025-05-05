const pool = require('./database');

async function resetCategoriesTable() {
  try {
    // Drop the existing table
    await pool.query('DROP TABLE IF EXISTS categories CASCADE');
    console.log('Categories table dropped successfully');

    // Create the new table
    await pool.query(`
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        image_url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Categories table created successfully');

    // Close the pool
    await pool.end();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error resetting categories table:', error);
    process.exit(1);
  }
}

resetCategoriesTable();
