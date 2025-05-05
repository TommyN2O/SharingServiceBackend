const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runMigration() {
  const client = await pool.connect();
  try {
    // Read the migration SQL
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'add_updated_at_to_tasker_profiles.sql'),
      'utf8',
    );

    // Run the migration
    await client.query('BEGIN');
    await client.query(migrationSQL);
    await client.query('COMMIT');

    console.log('Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error running migration:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
