require('dotenv').config();
const User = require('../models/User');
const UserDevice = require('../models/UserDevice');
const pool = require('../config/database');

async function testDeviceRegistration() {
  try {
    console.log('\n1. Getting a test user...');
    const userResult = await pool.query('SELECT id FROM users LIMIT 1');
    if (userResult.rows.length === 0) {
      throw new Error('No users found in database');
    }
    const userId = userResult.rows[0].id;
    console.log('Using user ID:', userId);

    console.log('\n2. Creating a token for the user...');
    const user = new User();
    const token = await user.createToken(userId);
    console.log('Token created:', token ? 'Success' : 'Failed');

    console.log('\n3. Testing device token registration...');
    const testDeviceToken = `test_fcm_token_${Date.now()}`;
    const addedDevice = await UserDevice.addDeviceToken(userId, testDeviceToken);
    console.log('Device registered:', addedDevice);

    console.log('\n4. Verifying device token in database...');
    const tokens = await UserDevice.getDeviceTokens(userId);
    console.log('Retrieved tokens:', tokens);

    console.log('\n5. Cleaning up...');
    await UserDevice.removeDeviceToken(testDeviceToken);
    console.log('Test completed successfully! ✨');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testDeviceRegistration();
