const express = require('express');
const router = express.Router();
const taskerController = require('../controllers/taskerController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Tasker profile management
router.get('/profile', taskerController.getProfile);
router.post('/profile', taskerController.createProfile);
router.put('/profile', taskerController.updateProfile);
router.delete('/profile', taskerController.deleteProfile);
router.get('/profile/:userId', taskerController.getProfile);
router.get('/profiles', taskerController.getAllProfiles);
router.get('/profiles/:id', taskerController.getProfileById);

// Task management
router.get('/available-tasks', taskerController.getAvailableTasks);
router.post('/offers', taskerController.sendOffer);
router.post('/tasks/:taskId/accept', taskerController.acceptTask);
router.get('/tasks', taskerController.getTasks);
router.put('/tasks/:taskId/status', taskerController.updateTaskStatus);

module.exports = router; 