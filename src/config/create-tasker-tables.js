const pool = require('./database');

async function createTaskerTables() {
  try {
    // Drop existing tables if they exist
    await pool.query('DROP TABLE IF EXISTS tasker_gallery CASCADE');
    await pool.query('DROP TABLE IF EXISTS tasker_availability CASCADE');
    await pool.query('DROP TABLE IF EXISTS tasker_cities CASCADE');
    await pool.query('DROP TABLE IF EXISTS tasker_categories CASCADE');
    await pool.query('DROP TABLE IF EXISTS tasker_profiles CASCADE');
    console.log('Existing tasker tables dropped successfully');

    // Create tasker_profiles table
    await pool.query(`
      CREATE TABLE tasker_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        profile_photo TEXT,
        description TEXT,
        hourly_rate DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Tasker profiles table created successfully');

    // Create tasker_categories table
    await pool.query(`
      CREATE TABLE tasker_categories (
        tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (tasker_id, category_id)
      );
    `);
    console.log('Tasker categories table created successfully');

    // Create tasker_cities table
    await pool.query(`
      CREATE TABLE tasker_cities (
        tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
        city VARCHAR(100),
        PRIMARY KEY (tasker_id, city)
      );
    `);
    console.log('Tasker cities table created successfully');

    // Create tasker_availability table
    await pool.query(`
      CREATE TABLE tasker_availability (
        id SERIAL PRIMARY KEY,
        tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        time_slot TIME NOT NULL,
        is_available BOOLEAN DEFAULT true,
        UNIQUE (tasker_id, date, time_slot)
      );
    `);
    console.log('Tasker availability table created successfully');

    // Create tasker_gallery table
    await pool.query(`
      CREATE TABLE tasker_gallery (
        id SERIAL PRIMARY KEY,
        tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Tasker gallery table created successfully');

  } catch (error) {
    console.error('Error creating tasker tables:', error);
  } finally {
    await pool.end();
  }
}

createTaskerTables(); 