const FirebaseService = require('../services/firebaseService');
const UserDevice = require('../models/UserDevice');
const User = require('../models/User');

async function testNotifications() {
  try {
    console.log('🚀 Starting notification test...\n');

    // Test data - replace with actual test values
    const testUserId = 74; // The user ID you want to test with
    const testDeviceToken = 'c1uMbYpgQbyQrBhsBe3m7B:APA91bEYjaIOKqJbb8Ev6C_d69ya3MI9VWuG9C28WH7BnbgEx_HdsoBEai_7znlE30IVni0eX3arMtrWFiFsi3ffZnRhhM0kKDgoxxkcL8NZROB2ELYZvy42'; // Your FCM token

    // Step 1: Verify user exists
    console.log('1️⃣ Verifying user exists...');
    const user = await User.getById(testUserId);
    if (!user) {
      throw new Error(`User with ID ${testUserId} not found`);
    }
    console.log('✅ User found:', { id: user.id, name: user.name });

    // Step 2: Register device token
    console.log('\n2️⃣ Registering test device token...');
    const device = await UserDevice.addDeviceToken(testUserId, testDeviceToken);
    console.log('✅ Device token registered:', device);

    // Step 3: Send a test notification
    console.log('\n3️⃣ Sending test notification...');
    const notification = {
      title: '🎉 Test Notification',
      body: 'This is a test notification from the Sharing Service Backend!'
    };

    const data = {
      type: 'test',
      timestamp: new Date().toISOString()
    };

    const result = await FirebaseService.sendNotificationToUser(testUserId, notification, data);
    console.log('✅ Notification result:', result);

    // Step 4: Send a test chat message notification
    console.log('\n4️⃣ Sending test chat message notification...');
    const chatResult = await FirebaseService.sendChatMessageNotification(
      1, // sender ID (can be any existing user ID)
      testUserId, // receiver ID
      'Hey there! This is a test chat message 💬'
    );
    console.log('✅ Chat notification result:', chatResult);

    // Step 5: Cleanup (optional - comment out if you want to keep the token)
    console.log('\n5️⃣ Cleaning up - removing test device token...');
    await UserDevice.removeDeviceToken(testDeviceToken);
    console.log('✅ Test device token removed');

    console.log('\n✨ All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run the test
testNotifications()
  .then(() => {
    console.log('\n👋 Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test script failed:', error);
    process.exit(1);
  }); 