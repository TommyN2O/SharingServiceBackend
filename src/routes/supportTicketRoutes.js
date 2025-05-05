const express = require('express');

const router = express.Router();
const supportTicketController = require('../controllers/supportTicketController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Create a new support ticket
router.post('/', supportTicketController.createTicket);

// Get user's tickets
router.get('/', supportTicketController.getUserTickets);

module.exports = router;
