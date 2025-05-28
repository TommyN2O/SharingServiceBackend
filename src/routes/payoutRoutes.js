const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requestPayout, getPayoutRequests } = require('../controllers/payoutController');

// Protected routes that require authentication
router.use(authenticateToken);

// Request a payout
router.post('/request', requestPayout);

// Get user's payout requests
router.get('/requests', getPayoutRequests);

module.exports = router; 