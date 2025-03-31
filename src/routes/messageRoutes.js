const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Get conversations and messages
router.get('/conversations', messageController.getConversations);
router.get('/conversation/:userId', messageController.getConversation);

// Manage messages
router.post('/', messageController.sendMessage);
router.put('/read/:senderId', messageController.markAsRead);
router.delete('/:id', messageController.deleteMessage);

module.exports = router; 