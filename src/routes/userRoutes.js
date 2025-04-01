const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes (no auth required)
router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/count', userController.getUserCount);
router.get('/all', userController.getAllUsers);
router.get('/:id', userController.getUserById);

// Protected routes (auth required)
router.use(authMiddleware);

// Profile routes
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);

// Dashboard and other routes
router.get('/dashboard', userController.getDashboard);
router.get('/customer-requests', userController.getCustomerRequests);
router.get('/saved-taskers', userController.getSavedTaskers);
router.post('/saved-taskers', userController.saveTasker);
router.get('/messages', userController.getMessages);
router.get('/messages/:userId', userController.getConversation);

module.exports = router; 