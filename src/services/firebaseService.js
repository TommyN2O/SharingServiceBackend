const admin = require('../config/firebase');
const UserDevice = require('../models/UserDevice');

class FirebaseService {
  /**
   * Send a notification to a specific user
   * @param {number} userId - The user ID to send notification to
   * @param {Object} notification - The notification object
   * @param {string} notification.title - The notification title
   * @param {string} notification.body - The notification body
   * @param {Object} [data] - Optional data payload
   * @returns {Promise<Object>} - Result of the send operation
   */
  static async sendNotificationToUser(userId, notification, data = {}) {
    try {
      // Get all device tokens for the user
      const deviceTokens = await UserDevice.getDeviceTokens(userId);
      
      if (!deviceTokens.length) {
        console.log(`No device tokens found for user ${userId}`);
        return { success: false, error: 'No devices registered' };
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK' // Required for Flutter apps
        }
      };

      const results = await Promise.all(
        deviceTokens.map(async (token) => {
          try {
            message.token = token;
            const response = await admin.messaging().send(message);
            return { success: true, messageId: response };
          } catch (error) {
            console.error(`Error sending to token ${token}:`, error);
            
            // If token is invalid or expired, remove it
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
              await UserDevice.removeDeviceToken(token);
            }
            
            return { success: false, error: error.message };
          }
        })
      );

      return {
        success: true,
        results,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length
      };
    } catch (error) {
      console.error('Error in sendNotificationToUser:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a notification to multiple users
   * @param {number[]} userIds - Array of user IDs
   * @param {Object} notification - The notification object
   * @param {string} notification.title - The notification title
   * @param {string} notification.body - The notification body
   * @param {Object} [data] - Optional data payload
   * @returns {Promise<Object>} - Result of the send operation
   */
  static async sendNotificationToUsers(userIds, notification, data = {}) {
    try {
      const results = await Promise.all(
        userIds.map(userId => 
          this.sendNotificationToUser(userId, notification, data)
        )
      );

      return {
        success: true,
        results,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length
      };
    } catch (error) {
      console.error('Error in sendNotificationToUsers:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a chat message notification
   * @param {number} senderId - The sender's user ID
   * @param {number} receiverId - The receiver's user ID
   * @param {string} message - The message content
   * @returns {Promise<Object>} - Result of the send operation
   */
  static async sendChatMessageNotification(senderId, receiverId, message) {
    try {
      // Get sender's name from database
      const pool = require('../config/database');
      const client = await pool.connect();
      
      try {
        const userQuery = 'SELECT name, surname FROM users WHERE id = $1';
        const userResult = await client.query(userQuery, [senderId]);
        const sender = userResult.rows[0];
        
        if (!sender) {
          throw new Error('Sender not found');
        }

        const notification = {
          title: `New message from ${sender.name} ${sender.surname}`,
          body: message.length > 100 ? message.substring(0, 97) + '...' : message
        };

        const data = {
          type: 'chat_message',
          senderId: senderId.toString(),
          senderName: `${sender.name} ${sender.surname}`,
          messagePreview: message.substring(0, 100)
        };

        return await this.sendNotificationToUser(receiverId, notification, data);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error sending chat message notification:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = FirebaseService; 