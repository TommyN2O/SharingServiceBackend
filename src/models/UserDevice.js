const pool = require('../config/database');

class UserDevice {
  static async addDeviceToken(userId, deviceToken) {
    console.log('Adding device token:', { userId, deviceToken });
    const client = await pool.connect();
    try {
      const query = `
        INSERT INTO user_devices (user_id, device_token)
        VALUES ($1, $2)
        ON CONFLICT (device_token) 
        DO UPDATE SET user_id = $1, updated_at = NOW()
        RETURNING *
      `;
      console.log('Executing query:', query);
      console.log('Query parameters:', [userId, deviceToken]);

      const result = await client.query(query, [userId, deviceToken]);
      console.log('Query result:', result.rows[0]);
      return result.rows[0];
    } catch (error) {
      console.error('Error adding device token:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async getDeviceTokens(userId) {
    console.log('Getting device tokens for user:', userId);
    const client = await pool.connect();
    try {
      const query = `
        SELECT device_token
        FROM user_devices
        WHERE user_id = $1
      `;
      const result = await client.query(query, [userId]);
      console.log('Found device tokens:', result.rows);
      return result.rows.map((row) => row.device_token);
    } catch (error) {
      console.error('Error getting device tokens:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async removeDeviceToken(deviceToken) {
    console.log('Removing device token:', deviceToken);
    const client = await pool.connect();
    try {
      const query = `
        DELETE FROM user_devices
        WHERE device_token = $1
      `;
      const result = await client.query(query, [deviceToken]);
      console.log('Delete result:', result);
    } catch (error) {
      console.error('Error removing device token:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async checkTableExists() {
    const client = await pool.connect();
    try {
      const query = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'user_devices'
        );
      `;
      const result = await client.query(query);
      console.log('user_devices table exists:', result.rows[0].exists);
      return result.rows[0].exists;
    } catch (error) {
      console.error('Error checking table existence:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = UserDevice;
