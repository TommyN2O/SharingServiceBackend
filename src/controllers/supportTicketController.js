const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');

const supportTicketController = {
  // Create a new support ticket
  async createTicket(req, res) {
    try {
      const { type, content } = req.body;
      const userId = req.user.id; // From auth middleware

      // Validate input
      if (!type || !content) {
        return res.status(400).json({
          error: 'Type and content are required'
        });
      }

      // Get user details
      const user = await User.getById(userId);
      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      // Create ticket with user details
      const ticket = await SupportTicket.createTicket({
        sender_id: userId,
        sender_name: user.name,
        sender_surname: user.surname,
        sender_email: user.email,
        type,
        content
      });

      res.status(201).json({
        message: 'Support ticket created successfully',
        ticket: {
          id: ticket.id,
          sender_id: ticket.sender_id,
          sender_name: ticket.sender_name,
          sender_surname: ticket.sender_surname,
          sender_email: ticket.sender_email,
          type: ticket.type,
          content: ticket.content,
          created_at: ticket.created_at,
          status: ticket.status
        }
      });
    } catch (error) {
      console.error('Error creating support ticket:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  },

  // Get user's tickets
  async getUserTickets(req, res) {
    try {
      const userId = req.user.id;
      const tickets = await SupportTicket.getTicketsBySenderId(userId);

      res.status(200).json({
        tickets: tickets.map(ticket => ({
          id: ticket.id,
          sender_id: ticket.sender_id,
          sender_name: ticket.sender_name,
          sender_surname: ticket.sender_surname,
          sender_email: ticket.sender_email,
          type: ticket.type,
          content: ticket.content,
          created_at: ticket.created_at,
          status: ticket.status
        }))
      });
    } catch (error) {
      console.error('Error getting user tickets:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  }
};

module.exports = supportTicketController; 