const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const authMiddleware = require('../middleware/authMiddleware');

// Protected routes
router.use(authMiddleware);

// Create a new task
router.post('/', taskController.createTask);

// Accept a task
router.post('/:taskId/accept', taskController.acceptTask);

// Get task by ID
router.get('/:taskId', taskController.getTaskById);

module.exports = router;
