require('dotenv').config();
const pool = require('../config/database');

async function checkUser() {
  try {
    console.log('\nChecking user in database...');
    const result = await pool.query('SELECT id, email, name, surname FROM users WHERE id = $1', [74]);
    
    if (result.rows.length === 0) {
      console.log('User with ID 74 does not exist in the database');
    } else {
      console.log('User found:', result.rows[0]);
    }

  } catch (error) {
    console.error('Error checking user:', error);
  } finally {
    await pool.end();
  }
}

checkUser(); 