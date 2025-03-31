const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');

// Customer request routes
router.post('/requests', taskController.createRequest);
router.get('/requests/:requestId', taskController.getRequestDetails);

// Offer management routes
router.post('/offers/:offerId/accept', taskController.acceptOffer);
router.post('/offers/:offerId/decline', taskController.declineOffer);

// Task management routes
router.post('/planned-tasks/:taskId/accept', taskController.acceptPlannedTask);

// Review routes
router.post('/tasks/:taskId/review', taskController.createReview);

module.exports = router; 