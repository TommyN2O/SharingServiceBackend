const Review = require('../models/Review');
const PlannedTask = require('../models/PlannedTask');
const TaskerProfile = require('../models/TaskerProfile');

const reviewController = {
  // Get all reviews for a tasker
  async getTaskerReviews(req, res) {
    try {
      const { taskerId } = req.params;
      const reviews = await Review.findByTaskerId(taskerId);
      res.json(reviews);
    } catch (error) {
      res.status(400).json({ error: error.message });
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
      const { taskId, rating, comment } = req.body;

      // Check if task exists and is completed
      const task = await PlannedTask.findById(taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      if (task.status !== 'completed') {
        return res.status(400).json({ error: 'Can only review completed tasks' });
      }

      // Check if user is the customer who requested the task
      if (task.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Only the customer can review the task' });
      }

      // Create review
      const review = await Review.create({
        task_id: taskId,
        customer_id: req.user.id,
        tasker_id: task.tasker_id,
        rating,
        comment,
      });

      // Update tasker's average rating
      const taskerReviews = await Review.findByTaskerId(task.tasker_id);
      const avgRating = taskerReviews.reduce((acc, rev) => acc + rev.rating, 0) / taskerReviews.length;
      await TaskerProfile.update(task.tasker_id, { rating: avgRating });

      res.status(201).json(review);
    } catch (error) {
      res.status(400).json({ error: error.message });
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
};

module.exports = reviewController;
