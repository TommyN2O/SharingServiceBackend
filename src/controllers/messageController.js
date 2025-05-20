const pool = require('../config/database');
const Message = require('../models/Message');
const NotificationService = require('../services/notificationService');

const messageController = {
  // Get all user's chats
  async getUserChats(req, res) {
    try {
      const userId = req.user.id;
      console.log('Getting all chats for user:', userId);

      const client = await pool.connect();
      try {
        const query = `
          WITH latest_messages AS (
            SELECT DISTINCT ON (m.chat_id)
              m.chat_id,
              m.id as message_id,
              m.sender_id,
              m.receiver_id,
              m.content as message,
              m.created_at,
              c.user1_id,
              c.user2_id
            FROM messages m
            JOIN chats c ON m.chat_id = c.id
            WHERE c.user1_id = $1 OR c.user2_id = $1
            ORDER BY m.chat_id, m.created_at DESC
          )
          SELECT 
            c.id as "chatId",
            lm.message_id as "lastMessageId",
            lm.message as "lastMessage",
            lm.created_at as "lastMessageTime",
            CASE 
              WHEN c.user1_id = $1 THEN json_build_object(
                'id', u2.id,
                'name', u2.name,
                'surname', u2.surname,
                'profile_photo', CASE 
                  WHEN EXISTS (
                    SELECT 1 FROM task_requests tr 
                    WHERE tr.tasker_id = u2.id AND tr.sender_id = $1
                  ) THEN COALESCE(tp2.profile_photo, '')
                  ELSE COALESCE(u2.profile_photo, '')
                END,
                'is_tasker', u2.is_tasker
              )
              ELSE json_build_object(
                'id', u1.id,
                'name', u1.name,
                'surname', u1.surname,
                'profile_photo', CASE 
                  WHEN EXISTS (
                    SELECT 1 FROM task_requests tr 
                    WHERE tr.tasker_id = u1.id AND tr.sender_id = $1
                  ) THEN COALESCE(tp1.profile_photo, '')
                  ELSE COALESCE(u1.profile_photo, '')
                END,
                'is_tasker', u1.is_tasker
              )
            END as "otherUser"
          FROM chats c
          LEFT JOIN latest_messages lm ON c.id = lm.chat_id
          JOIN users u1 ON c.user1_id = u1.id
          LEFT JOIN tasker_profiles tp1 ON u1.id = tp1.user_id
          JOIN users u2 ON c.user2_id = u2.id
          LEFT JOIN tasker_profiles tp2 ON u2.id = tp2.user_id
          WHERE c.user1_id = $1 OR c.user2_id = $1
          ORDER BY lm.created_at DESC NULLS LAST
        `;

        const result = await client.query(query, [userId]);
        console.log(`Found ${result.rows.length} chats`);

        res.json(result.rows);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting user chats:', error);
      res.status(500).json({
        error: 'Failed to get user chats',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get all conversations for the authenticated user
  async getConversations(req, res) {
    try {
      const userId = req.user.id;
      console.log('Getting conversations for user ID:', userId);

      const client = await pool.connect();
      try {
        // Get all conversations with latest message and user details
        const query = `
          WITH latest_messages AS (
            SELECT DISTINCT ON (
              CASE 
                WHEN sender_id = $1 THEN receiver_id 
                ELSE sender_id 
              END
            )
              m.id,
              m.sender_id,
              m.receiver_id,
              m.message as message,
              m.created_at,
              CASE 
                WHEN sender_id = $1 THEN receiver_id 
                ELSE sender_id 
              END as other_user_id
            FROM messages m
            WHERE m.sender_id = $1 OR m.receiver_id = $1
            ORDER BY 
              other_user_id,
              m.created_at DESC
          )
          SELECT 
            lm.*,
            u.name,
            u.surname,
            COALESCE(u.profile_photo, '') as profile_photo
          FROM latest_messages lm
          JOIN users u ON u.id = lm.other_user_id
          ORDER BY lm.created_at DESC
        `;

        const result = await client.query(query, [userId]);

        // Format the response
        const conversations = result.rows.map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          receiverId: row.receiver_id,
          message: row.message,
          createdAt: row.created_at,
          otherUser: {
            id: row.other_user_id,
            name: row.name,
            surname: row.surname,
            profile_photo: row.profile_photo,
          },
        }));

        console.log(`Found ${conversations.length} conversations`);
        res.json(conversations);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting conversations:', error);
      res.status(500).json({
        error: 'Failed to get conversations',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get chat details with both users' information
  async getChat(req, res) {
    try {
      const userId = req.user.id;
      const otherUserId = req.params.userId;
      console.log('Getting chat details between users:', userId, 'and', otherUserId);

      const client = await pool.connect();
      try {
        const query = `
          WITH chat_users AS (
            SELECT 
              u.id,
              u.name,
              u.surname,
              CASE 
                WHEN EXISTS (
                  SELECT 1 FROM task_requests tr 
                  WHERE tr.tasker_id = u.id AND tr.sender_id = ANY(ARRAY(SELECT UNNEST($1) EXCEPT SELECT u.id))
                ) THEN COALESCE(tp.profile_photo, '')
                ELSE COALESCE(u.profile_photo, '')
              END as profile_photo,
              u.is_tasker
            FROM users u
            LEFT JOIN tasker_profiles tp ON u.id = tp.user_id
            WHERE u.id = ANY($1)
          )
          SELECT *
          FROM chat_users
        `;

        const result = await client.query(query, [[userId, otherUserId]]);

        if (result.rows.length < 2) {
          return res.status(404).json({
            error: 'One or both users not found',
          });
        }

        // Format the response with isRequester field
        const response = {
          user1: {
            ...result.rows.find((u) => u.id === userId),
            isRequester: true,
          },
          user2: {
            ...result.rows.find((u) => u.id === otherUserId),
            isRequester: false,
          },
        };

        res.json(response);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting chat details:', error);
      res.status(500).json({
        error: 'Failed to get chat details',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get messages between two users
  async getMessages(req, res) {
    try {
      const userId = req.user.id;
      const otherUserId = req.params.userId;
      console.log('Getting messages between users:', userId, 'and', otherUserId);

      const client = await pool.connect();
      try {
        const query = `
          SELECT 
            m.id,
            m.message,
            m.created_at as "createdAt",
            m.sender_id as "senderId",
            m.receiver_id as "receiverId"
          FROM messages m
          WHERE (m.sender_id = $1 AND m.receiver_id = $2)
             OR (m.sender_id = $2 AND m.receiver_id = $1)
          ORDER BY m.created_at DESC
        `;

        const result = await client.query(query, [userId, otherUserId]);
        console.log(`Found ${result.rows.length} messages`);

        res.json(result.rows);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({
        error: 'Failed to get messages',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Create or get chat between two users
  async createChat(req, res) {
    try {
      const userId = parseInt(req.user.id, 10);
      const receiverId = parseInt(req.body.receiverId, 10);

      if (!receiverId || isNaN(receiverId)) {
        return res.status(400).json({
          error: 'receiverId is required and must be a valid number',
        });
      }

      if (receiverId === userId) {
        return res.status(400).json({
          error: 'Cannot create chat with yourself',
        });
      }

      console.log('Creating/getting chat between users:', userId, 'and', receiverId);

      const client = await pool.connect();
      try {
        // Check if chat exists in either order
        const chatCheckQuery = `
          SELECT id, user1_id, user2_id FROM chats
          WHERE (user1_id = $1 AND user2_id = $2)
             OR (user1_id = $2 AND user2_id = $1)
        `;
        console.log('Finding chat with query:', chatCheckQuery);
        console.log('Query params:', [userId, receiverId]);

        const existingChat = await client.query(chatCheckQuery, [userId, receiverId]);
        console.log('Existing chat result:', existingChat.rows);

        let chatId;
        if (existingChat.rows.length > 0) {
          chatId = existingChat.rows[0].id;
          console.log('Found existing chat:', chatId);
        } else {
          // Create new chat if it doesn't exist
          const createChatQuery = `
            INSERT INTO chats (user1_id, user2_id, created_at)
            VALUES (
              LEAST($1::integer, $2::integer),
              GREATEST($1::integer, $2::integer),
              NOW()
            )
            RETURNING id
          `;
          const newChat = await client.query(createChatQuery, [userId, receiverId]);
          chatId = newChat.rows[0].id;
          console.log('Created new chat:', chatId);
        }

        // Get users details
        const usersQuery = `
          SELECT 
            u.id,
            u.name,
            u.surname,
            COALESCE(
              CASE WHEN u.is_tasker AND EXISTS (
                SELECT 1 FROM task_requests tr 
                WHERE tr.tasker_id = u.id 
                AND tr.sender_id = $1
              ) THEN tp.profile_photo
              ELSE u.profile_photo
              END,
              ''
            ) as profile_photo,
            u.is_tasker
          FROM users u
          LEFT JOIN tasker_profiles tp ON u.id = tp.user_id
          WHERE u.id IN ($1, $2)
        `;

        const result = await client.query(usersQuery, [userId, receiverId]);

        if (result.rows.length < 2) {
          return res.status(404).json({
            error: 'One or both users not found',
          });
        }

        // Format the response with isRequester field and chatId
        const response = {
          chatId,
          user1: {
            ...result.rows.find((u) => u.id === userId),
            isRequester: true,
          },
          user2: {
            ...result.rows.find((u) => u.id === receiverId),
            isRequester: false,
          },
        };

        res.status(201).json(response);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating chat:', error);
      res.status(500).json({
        error: 'Failed to create chat',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Send a message
  async sendMessage(req, res) {
    try {
      const senderId = req.user.id;
      const { receiverId, message, chatId } = req.body;

      console.log('Request body:', req.body);
      console.log('Sender ID:', senderId);

      if (!receiverId || !message || !chatId) {
        console.log('Missing fields:', { receiverId, message, chatId });
        return res.status(400).json({
          error: 'receiverId, chatId and message are required',
        });
      }

      console.log('Sending message from', senderId, 'to', receiverId, 'in chat', chatId);

      const client = await pool.connect();
      try {
        // Verify chat exists and users are part of it
        const chatVerifyQuery = `
          SELECT id FROM chats 
          WHERE id = $1 
          AND (
            (user1_id = $2 AND user2_id = $3)
            OR 
            (user1_id = $3 AND user2_id = $2)
          )
        `;
        console.log('Verifying chat with query:', chatVerifyQuery);
        console.log('Query params:', [chatId, senderId, receiverId]);

        const chatVerify = await client.query(chatVerifyQuery, [chatId, senderId, receiverId]);
        console.log('Chat verify result:', chatVerify.rows);

        if (chatVerify.rows.length === 0) {
          return res.status(404).json({
            error: 'Chat not found or users are not part of this chat',
          });
        }

        // Insert the message
        const insertQuery = `
          INSERT INTO messages (chat_id, sender_id, receiver_id, content, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING 
            id,
            chat_id as "chatId",
            sender_id as "senderId",
            receiver_id as "receiverId",
            content as message,
            created_at as "createdAt"
        `;
        console.log('Inserting message with query:', insertQuery);
        console.log('Insert params:', [chatId, senderId, receiverId, message]);

        const messageResult = await client.query(insertQuery, [chatId, senderId, receiverId, message]);
        const newMessage = messageResult.rows[0];

        // Send notification to the receiver
        await NotificationService.sendMessageNotification(senderId, receiverId, message);

        console.log('Message sent successfully:', newMessage);
        res.status(201).json(newMessage);
      } catch (error) {
        console.error('Database error:', error);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({
        error: 'Failed to send message',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  },

  // Mark messages as read
  async markAsRead(req, res) {
    try {
      const { senderId } = req.params;
      await Message.markAsRead(req.user.id, senderId);
      res.json({ message: 'Messages marked as read' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Delete a message
  async deleteMessage(req, res) {
    try {
      const message = await Message.findById(req.params.id);

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Check if user is the sender
      if (message.sender_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to delete this message' });
      }

      await Message.delete(req.params.id);
      res.json({ message: 'Message deleted successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get messages by chat ID
  async getChatMessages(req, res) {
    try {
      const userId = req.user.id;
      const { chatId } = req.params;

      console.log('Getting messages for chat:', chatId, 'requested by user:', userId);

      const client = await pool.connect();
      try {
        // First verify user is part of this chat
        const chatVerifyQuery = `
          SELECT id FROM chats 
          WHERE id = $1 
          AND (user1_id = $2 OR user2_id = $2)
        `;

        const chatVerify = await client.query(chatVerifyQuery, [chatId, userId]);

        if (chatVerify.rows.length === 0) {
          return res.status(403).json({
            error: 'You are not a participant in this chat',
          });
        }

        // Get messages
        const query = `
          SELECT 
            m.id,
            m.chat_id as "chatId",
            m.sender_id as "senderId",
            m.receiver_id as "receiverId",
            m.content as message,
            m.created_at as "createdAt",
            json_build_object(
              'id', s.id,
              'name', s.name,
              'surname', s.surname,
              'profile_photo', CASE 
                WHEN EXISTS (
                  SELECT 1 FROM task_requests tr 
                  WHERE tr.tasker_id = s.id AND tr.sender_id = r.id
                ) THEN COALESCE(sp.profile_photo, '')
                ELSE COALESCE(s.profile_photo, '')
              END,
              'is_tasker', s.is_tasker
            ) as sender,
            json_build_object(
              'id', r.id,
              'name', r.name,
              'surname', r.surname,
              'profile_photo', CASE 
                WHEN EXISTS (
                  SELECT 1 FROM task_requests tr 
                  WHERE tr.tasker_id = r.id AND tr.sender_id = s.id
                ) THEN COALESCE(rp.profile_photo, '')
                ELSE COALESCE(r.profile_photo, '')
              END,
              'is_tasker', r.is_tasker
            ) as receiver
          FROM messages m
          JOIN users s ON m.sender_id = s.id
          LEFT JOIN tasker_profiles sp ON s.id = sp.user_id
          JOIN users r ON m.receiver_id = r.id
          LEFT JOIN tasker_profiles rp ON r.id = rp.user_id
          WHERE m.chat_id = $1
          ORDER BY m.created_at DESC
        `;

        const result = await client.query(query, [chatId]);
        console.log(`Found ${result.rows.length} messages`);

        res.json(result.rows);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting chat messages:', error);
      res.status(500).json({
        error: 'Failed to get chat messages',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
};

module.exports = messageController;
