const express = require('express');

const router = express.Router();
const { body } = require('express-validator');
const reviewController = require('../controllers/reviewController');
const { authenticateToken } = require('../middleware/auth');

// Validation middleware
const reviewValidation = [
  body('task_request_id').isInt().withMessage('Task request ID must be an integer'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('review').isString().trim().optional()
    .isLength({ max: 1000 })
    .withMessage('Review must not exceed 1000 characters'),
];

// Create a review for a completed task
router.post('/', authenticateToken, reviewValidation, reviewController.createReview);

// Get all reviews for a tasker
router.get('/tasker/:taskerId', reviewController.getTaskerReviews);

// Get tasker's average rating and review summary
router.get('/tasker/:taskerId/rating', reviewController.getTaskerRating);

// Get review for a specific task request
router.get('/task-request/:taskRequestId', reviewController.getTaskReview);
router.get('/task-request/:taskRequestId/status', reviewController.getReviewStatus);

module.exports = router;
