const Message = require('../models/Message');
const User = require('../models/User');

const messageController = {
  // Get all conversations for a user
  async getConversations(req, res) {
    try {
      const conversations = await Message.getRecentConversations(req.user.id);
      res.json(conversations);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get conversation with specific user
  async getConversation(req, res) {
    try {
      const { userId } = req.params;
      const messages = await Message.getConversation(req.user.id, userId);
      res.json(messages);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Send a message
  async sendMessage(req, res) {
    try {
      const { receiverId, content, type = 'message' } = req.body;

      // Check if receiver exists
      const receiver = await User.findById(receiverId);
      if (!receiver) {
        return res.status(404).json({ error: 'Receiver not found' });
      }

      // Don't allow sending messages to yourself
      if (receiverId === req.user.id) {
        return res.status(400).json({ error: 'Cannot send message to yourself' });
      }

      const message = await Message.create({
        sender_id: req.user.id,
        receiver_id: receiverId,
        content,
        type
      });

      res.status(201).json(message);
    } catch (error) {
      res.status(400).json({ error: error.message });
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
  }
};

module.exports = messageController; 