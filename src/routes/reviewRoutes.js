const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken } = require('../middleware/auth');

// Protected routes
router.use(authenticateToken);

// Get reviews
router.get('/tasker/:taskerId', reviewController.getTaskerReviews);
router.get('/:id', reviewController.getReviewById);

// Manage reviews
router.post('/', reviewController.createReview);
router.put('/:id', reviewController.updateReview);
router.delete('/:id', reviewController.deleteReview);

module.exports = router;
