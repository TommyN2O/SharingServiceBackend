const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  getConversations,
  getMessages,
  sendMessage,
  getChat,
  createChat,
  getChatMessages,
  getUserChats,
} = require('../controllers/messageController');

// Protected routes
router.use(authenticateToken);

// Get all user's chats
router.get('/chats', getUserChats);

// Get all conversations for the authenticated user
router.get('/conversations', getConversations);

// Create new chat
router.post('/chat', createChat);

// Get chat details between two users
router.get('/chat/:userId', getChat);

// Get messages for a specific chat
router.get('/chat/:chatId/messages', getChatMessages);

// Get messages between authenticated user and another user
router.get('/messages/:userId', getMessages);

// Send a message
router.post('/send', sendMessage);

module.exports = router;
