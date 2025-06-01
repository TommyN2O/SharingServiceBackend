const admin = require('../config/firebase');

/**
 * Send a notification to a specific device
 * @param {string} token - The FCM token of the device
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} [data] - Optional data payload
 * @returns {Promise<Object>} - Firebase messaging response
 */
const sendNotification = async (token, title, body, data = {}) => {
  try {
    const message = {
      notification: {
        title,
        body,
      },
      data,
      token,
    };

    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
};

/**
 * Send notifications to multiple devices
 * @param {string[]} tokens - Array of FCM tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} [data] - Optional data payload
 * @returns {Promise<Object>} - Firebase messaging response
 */
const sendMulticastNotification = async (tokens, title, body, data = {}) => {
  try {
    const message = {
      notification: {
        title,
        body,
      },
      data,
      tokens,
    };

    const response = await admin.messaging().sendMulticast(message);
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    };
  } catch (error) {
    console.error('Error sending multicast notification:', error);
    throw error;
  }
};

module.exports = {
  sendNotification,
  sendMulticastNotification,
};
