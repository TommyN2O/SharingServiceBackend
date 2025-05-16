const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createCheckoutSession, handleWebhook, handleSuccess, handleCancel,
} = require('../controllers/paymentController');

// Public routes that don't require authentication
// These are called by Stripe and need to be before the authenticateToken middleware
router.post('/webhook', handleWebhook);
router.get('/success', handleSuccess);
router.get('/cancel', handleCancel);

// Protected routes that require authentication
router.use(authenticateToken);

// Create checkout session (requires authentication)
router.post('/create-checkout-session', createCheckoutSession);

module.exports = router;
