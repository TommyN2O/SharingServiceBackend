const { validationResult } = require('express-validator');
const Review = require('../models/Review');
const TaskRequest = require('../models/TaskRequest');
const pool = require('../config/database');

const reviewController = {
  // Get all reviews for a tasker
  async getTaskerReviews(req, res) {
    try {
      const { taskerId } = req.params;
      const reviews = await Review.findByRevieweeId(taskerId);
      res.json(reviews);
    } catch (error) {
      console.error('Error fetching tasker reviews:', error);
      res.status(500).json({ message: 'Error fetching reviews' });
    }
  },

  // Get review by ID
  async getReviewById(req, res) {
    try {
      const review = await Review.findById(req.params.id);
      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }
      res.json(review);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create new review
  async createReview(req, res) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { task_request_id, rating, review } = req.body;
      const reviewer_id = req.user.id; // Get from authenticated user

      // Verify task request exists and is completed
      const taskRequest = await TaskRequest.findById(task_request_id);
      if (!taskRequest) {
        return res.status(404).json({ message: 'Task request not found' });
      }

      if (String(taskRequest.status).toLowerCase() !== 'completed') {
        return res.status(400).json({ message: 'Can only review completed tasks' });
      }

      // Verify the reviewer is the task requester
      if (taskRequest.sender_id !== reviewer_id) {
        return res.status(403).json({ message: 'Only the task requester can leave a review' });
      }

      // Check if review already exists
      const existingReview = await Review.checkReviewExists(task_request_id);
      if (existingReview) {
        return res.status(400).json({ message: 'Review already exists for this task' });
      }

      // Create the review
      const reviewData = {
        task_request_id,
        reviewer_id,
        reviewee_id: taskRequest.tasker_id,
        rating,
        review,
      };

      const newReview = await Review.createReview(reviewData);

      // Get reviewer's name for notification
      const reviewerQuery = `
        SELECT name, surname 
        FROM users 
        WHERE id = $1
      `;
      const reviewerResult = await pool.query(reviewerQuery, [reviewer_id]);
      const reviewer = reviewerResult.rows[0];

      // Send notification to tasker
      const FirebaseService = require('../services/firebaseService');
      await FirebaseService.sendTaskRequestNotification(
        reviewer_id,
        taskRequest.tasker_id,
        {
          id: task_request_id.toString(),
          title: '⭐ Naujas atsiliepimas',
          description: `${reviewer.name} ${reviewer.surname[0]}. paliko jums atsiliepimą`,
          type: 'new_review',
        },
      );

      res.status(201).json(newReview);
    } catch (error) {
      console.error('Error creating review:', error);
      res.status(500).json({ message: 'Error creating review' });
    }
  },

  // Update review
  async updateReview(req, res) {
    try {
      const { rating, comment } = req.body;
      const review = await Review.findById(req.params.id);

      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      // Check if user is the one who created the review
      if (review.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to update this review' });
      }

      const updatedReview = await Review.update(req.params.id, { rating, comment });

      // Update tasker's average rating
      const taskerReviews = await Review.findByTaskerId(review.tasker_id);
      const avgRating = taskerReviews.reduce((acc, rev) => acc + rev.rating, 0) / taskerReviews.length;
      await TaskerProfile.update(review.tasker_id, { rating: avgRating });

      res.json(updatedReview);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Delete review
  async deleteReview(req, res) {
    try {
      const review = await Review.findById(req.params.id);

      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      // Check if user is the one who created the review
      if (review.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to delete this review' });
      }

      await Review.delete(req.params.id);

      // Update tasker's average rating
      const taskerReviews = await Review.findByTaskerId(review.tasker_id);
      const avgRating = taskerReviews.length > 0
        ? taskerReviews.reduce((acc, rev) => acc + rev.rating, 0) / taskerReviews.length
        : 0;
      await TaskerProfile.update(review.tasker_id, { rating: avgRating });

      res.json({ message: 'Review deleted successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get tasker's average rating
  async getTaskerRating(req, res) {
    try {
      const { taskerId } = req.params;
      const rating = await Review.getTaskerAverageRating(taskerId);
      res.json(rating);
    } catch (error) {
      console.error('Error fetching tasker rating:', error);
      res.status(500).json({ message: 'Error fetching rating' });
    }
  },

  // Get task review
  async getTaskReview(req, res) {
    try {
      const { taskRequestId } = req.params;
      const review = await Review.findByTaskRequestId(taskRequestId);

      if (!review) {
        return res.status(404).json({ message: 'Review not found' });
      }

      res.json(review);
    } catch (error) {
      console.error('Error fetching task review:', error);
      res.status(500).json({ message: 'Error fetching review' });
    }
  },

  // Get review status for a task
  async getReviewStatus(req, res) {
    try {
      const { taskRequestId } = req.params;
      const status = await Review.getReviewStatus(taskRequestId);
      res.json(status);
    } catch (error) {
      console.error('Error checking review status:', error);
      res.status(500).json({ message: 'Error checking review status' });
    }
  },
};

module.exports = reviewController;
