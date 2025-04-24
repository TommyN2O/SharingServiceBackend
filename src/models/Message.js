const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class Message extends BaseModel {
  constructor() {
    super('messages');
  }

  async initialize() {
    try {
      // Drop the table first to ensure clean state
      await pool.query('DROP TABLE IF EXISTS messages CASCADE');
      
      // Create the table with correct structure
      await pool.query(`
        CREATE TABLE messages (
          id SERIAL PRIMARY KEY,
          sender_id INTEGER REFERENCES users(id),
          receiver_id INTEGER REFERENCES users(id),
          content TEXT NOT NULL,
          type VARCHAR(20) DEFAULT 'message',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          seen BOOLEAN DEFAULT FALSE
        )
      `);
      console.log('Messages table initialized successfully');
    } catch (error) {
      console.error('Error initializing messages table:', error);
      throw error;
    }
  }

  async getConversation(userId1, userId2) {
    const query = `
      SELECT m.*, 
             s.name as sender_name, s.surname as sender_surname,
             r.name as receiver_name, r.surname as receiver_surname
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      JOIN users r ON m.receiver_id = r.id
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
    `;
    const { rows } = await pool.query(query, [userId1, userId2]);
    return rows;
  }

  async getUnreadMessages(userId) {
    const query = `
      SELECT m.*, 
             s.name as sender_name, s.surname as sender_surname
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      WHERE m.receiver_id = $1 AND m.seen = false
      ORDER BY m.created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  async markAsSeen(messageId, receiverId) {
    const query = `
      UPDATE messages
      SET seen = true
      WHERE id = $1 AND receiver_id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [messageId, receiverId]);
    return rows[0];
  }

  async getRecentConversations(userId) {
    const query = `
      WITH last_messages AS (
        SELECT DISTINCT ON (
          CASE 
            WHEN sender_id = $1 THEN receiver_id
            ELSE sender_id
          END
        )
        m.*,
        CASE 
          WHEN sender_id = $1 THEN receiver_id
          ELSE sender_id
        END as other_user_id
      FROM messages m
      WHERE sender_id = $1 OR receiver_id = $1
      ORDER BY 
        CASE 
          WHEN sender_id = $1 THEN receiver_id
          ELSE sender_id
        END,
        created_at DESC
      )
      SELECT lm.*,
             u.name as other_user_name,
             u.surname as other_user_surname
      FROM last_messages lm
      JOIN users u ON lm.other_user_id = u.id
      ORDER BY lm.created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }
}

module.exports = new Message(); 