const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class Message extends BaseModel {
  constructor() {
    super('messages');
  }

  async initialize() {
    try {
      // Check if tables exist first
      const tablesExist = await this.checkTablesExist();
      if (!tablesExist) {
        // Create chats table first
        await pool.query(`
          CREATE TABLE IF NOT EXISTS chats (
            id SERIAL PRIMARY KEY,
            user1_id INTEGER REFERENCES users(id),
            user2_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user1_id, user2_id),
            CHECK (user1_id < user2_id)
          )
        `);
        console.log('Chats table created successfully');

        // Then create messages table with chat_id reference
        await pool.query(`
          CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            chat_id INTEGER REFERENCES chats(id),
            sender_id INTEGER REFERENCES users(id),
            receiver_id INTEGER REFERENCES users(id),
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('Messages table created successfully');
      } else {
        // If tables exist, check if we need to migrate message to content
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'messages' AND column_name = 'message'
        `);

        if (columnCheck.rows.length > 0) {
          // Need to rename column from message to content
          await pool.query('ALTER TABLE messages RENAME COLUMN message TO content');
          console.log('Renamed message column to content');
        }
      }
    } catch (error) {
      console.error('Error initializing tables:', error);
      throw error;
    }
  }

  async checkTablesExist() {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'chats'
      ) as chats_exist,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      ) as messages_exist
    `;

    const result = await pool.query(query);
    const { chats_exist, messages_exist } = result.rows[0];

    console.log('Tables exist check:', { chats_exist, messages_exist });
    return chats_exist && messages_exist;
  }

  // Get or create chat between two users
  async getOrCreateChat(user1Id, user2Id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Try to find existing chat
      const findQuery = `
        SELECT id FROM chats 
        WHERE (user1_id = $1 AND user2_id = $2)
           OR (user1_id = $2 AND user2_id = $1)
      `;
      console.log('Finding chat with query:', findQuery);
      console.log('Query params:', [user1Id, user2Id]);

      const existingChat = await client.query(findQuery, [user1Id, user2Id]);
      console.log('Existing chat result:', existingChat.rows);

      if (existingChat.rows.length > 0) {
        await client.query('COMMIT');
        return existingChat.rows[0].id;
      }

      // Create new chat if doesn't exist
      const insertQuery = `
        INSERT INTO chats (user1_id, user2_id)
        VALUES ($1, $2)
        RETURNING id
      `;
      console.log('Creating new chat with query:', insertQuery);
      console.log('Insert params:', [user1Id, user2Id]);

      const newChat = await client.query(insertQuery, [user1Id, user2Id]);
      console.log('New chat created:', newChat.rows[0]);

      await client.query('COMMIT');
      return newChat.rows[0].id;
    } catch (error) {
      console.error('Error in getOrCreateChat:', error);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getConversation(userId1, userId2) {
    const query = `
      SELECT m.*, 
             s.name as sender_name, s.surname as sender_surname, s.profile_photo as sender_profile_photo,
             r.name as receiver_name, r.surname as receiver_surname, r.profile_photo as receiver_profile_photo
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
             s.name as sender_name, s.surname as sender_surname, s.profile_photo as sender_profile_photo
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
             u.surname as other_user_surname,
             u.profile_photo as other_user_profile_photo
      FROM last_messages lm
      JOIN users u ON lm.other_user_id = u.id
      ORDER BY lm.created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }
}

module.exports = new Message();
