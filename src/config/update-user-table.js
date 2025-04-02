const pool = require('./database');

async function updateUserTable() {
  try {
    // Add is_tasker column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' 
          AND column_name = 'is_tasker'
        ) THEN
          ALTER TABLE users ADD COLUMN is_tasker BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);
    console.log('Users table updated successfully');
  } catch (error) {
    console.error('Error updating users table:', error);
  } finally {
    await pool.end();
  }
}

updateUserTable(); 