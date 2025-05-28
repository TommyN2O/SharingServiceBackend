const { sendNotification } = require('../utils/notifications');
const UserDevice = require('../models/UserDevice');

class NotificationService {
  static async sendMessageNotification(senderId, receiverId, message) {
    try {
      // Get sender's name from the database
      const pool = require('../config/database');
      const client = await pool.connect();
      
      try {
        const userQuery = 'SELECT name, surname FROM users WHERE id = $1';
        const userResult = await client.query(userQuery, [senderId]);
        const sender = userResult.rows[0];
        
        if (!sender) {
          console.error('Sender not found:', senderId);
          return;
        }

        // Get receiver's device tokens
        const deviceTokens = await UserDevice.getDeviceTokens(receiverId);
        
        if (deviceTokens.length === 0) {
          console.log('No device tokens found for receiver:', receiverId);
          return;
        }

        const senderName = `${sender.name} ${sender.surname[0]}.`;
        const notificationTitle = `Nauja žinutė nuo ${senderName}`;
        const notificationBody = message.length > 100 ? message.substring(0, 97) + '...' : message;

        // Send notification to each device
        for (const token of deviceTokens) {
          await sendNotification(token, notificationTitle, notificationBody, {
            type: 'message',
            senderId: senderId.toString(),
            senderName
          });
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error sending message notification:', error);
    }
  }
}

module.exports = NotificationService; 