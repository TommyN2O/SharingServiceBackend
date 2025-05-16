const express = require('express');

const router = express.Router();
const supportTicketController = require('../controllers/supportTicketController');
const { authenticateToken } = require('../middleware/auth');

// Protected routes
router.use(authenticateToken);

// Create a new support ticket
router.post('/', supportTicketController.createTicket);

// Get user's tickets
router.get('/', supportTicketController.getUserTickets);

module.exports = router;
