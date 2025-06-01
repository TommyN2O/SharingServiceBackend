require('dotenv').config();
const UserDevice = require('../models/UserDevice');
const pool = require('../config/database');

async function testDeviceTable() {
  try {
    // 1. Check if table exists
    console.log('\n1. Checking if user_devices table exists...');
    const exists = await UserDevice.checkTableExists();
    console.log('Table exists:', exists);

    if (!exists) {
      console.log('Creating user_devices table...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_devices (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_token TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(device_token)
        )
      `);
      console.log('Table created successfully!');
    }

    // 2. Get a valid user ID from the database
    console.log('\n2. Getting a valid user ID from database...');
    const userResult = await pool.query('SELECT id FROM users LIMIT 1');
    if (userResult.rows.length === 0) {
      throw new Error('No users found in the database');
    }
    const userId = userResult.rows[0].id;
    console.log('Using user ID:', userId);

    // 3. Test adding a device token
    console.log('\n3. Testing device token addition...');
    const testToken = `test_fcm_token_${Date.now()}`;
    const addedDevice = await UserDevice.addDeviceToken(userId, testToken);
    console.log('Added device:', addedDevice);

    // 4. Test retrieving device tokens
    console.log('\n4. Testing device token retrieval...');
    const tokens = await UserDevice.getDeviceTokens(userId);
    console.log('Retrieved tokens:', tokens);

    // 5. Verify the token was added
    console.log('\n5. Verifying token in database...');
    const verifyResult = await pool.query(
      'SELECT * FROM user_devices WHERE device_token = $1',
      [testToken],
    );
    console.log('Verification result:', verifyResult.rows[0]);

    // 6. Clean up
    console.log('\n6. Cleaning up - removing test token...');
    await UserDevice.removeDeviceToken(testToken);
    console.log('Test completed successfully! ✨');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Run the test
testDeviceTable();
