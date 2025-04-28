const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { createCheckoutSession, handleWebhook, handleSuccess, handleCancel } = require('../controllers/paymentController');

// Create checkout session (requires authentication)
router.post('/create-checkout-session', auth, createCheckoutSession);

// Success and cancel redirect endpoints (no auth required as they're called by Stripe)
router.get('/success', handleSuccess);
router.get('/cancel', handleCancel);

// Webhook endpoint (no auth required as it's called by Stripe)
router.post('/webhook', 
  express.raw({type: 'application/json'}),
  handleWebhook
);

module.exports = router; 