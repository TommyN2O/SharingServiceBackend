const express = require('express');

const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');
const { uploadFields } = require('../controllers/taskerController');

// Public routes (no auth required)
router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/count', userController.getUserCount);
router.get('/all', userController.getAllUsers);

// Protected routes (auth required)
router.use(authenticateToken);

// Profile routes
router.get('/profile', userController.getProfile);
router.put('/profile', uploadFields, userController.updateUserProfile);

// Dashboard and other routes
router.get('/dashboard', userController.getDashboard);
router.get('/customer-requests', userController.getCustomerRequests);
router.get('/messages', userController.getMessages);
router.get('/messages/:userId', userController.getConversation);

// Saved taskers routes
router.get('/saved-taskers', userController.getSavedTaskers);
router.post('/save-tasker/:taskerId', userController.saveTasker);
router.delete('/saved-tasker/:taskerId', userController.removeSavedTasker);

// Complete user data route
router.get('/complete/:id', userController.getUserCompleteData);

// Get user by ID (must be last to avoid conflicts)
router.get('/:id', userController.getUserById);

router.post('/change-password', userController.changePassword);

module.exports = router;
