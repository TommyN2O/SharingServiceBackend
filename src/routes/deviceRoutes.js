const express = require('express');

const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { authenticateToken } = require('../middleware/auth');

// Protected routes - require authentication
router.use(authenticateToken);

// Register a device token
router.post('/token', deviceController.registerToken);

// Remove a device token
router.delete('/token', deviceController.removeToken);

module.exports = router;
