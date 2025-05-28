const CustomerRequest = require('../models/CustomerRequest');
const PlannedTask = require('../models/PlannedTask');
const Message = require('../models/Message');
const Review = require('../models/Review');
const pool = require('../config/database');
const paymentController = require('./paymentController');
const TaskerProfile = require('../models/TaskerProfile');
const TaskRequest = require('../models/TaskRequest');
const User = require('../models/User');

const taskController = {
  // Create a new customer request
  async createRequest(req, res) {
    try {
      const {
        name,
        profile_image,
        city,
        description,
        budget,
        due_date,
        gallery_images,
        needed_time,
        category_id,
      } = req.body;

      const request = await CustomerRequest.create({
        user_id: req.user.id,
        name,
        profile_image,
        city,
        description,
        budget,
        due_date,
        gallery_images,
        needed_time,
        category_id,
      });

      res.status(201).json(request);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get request details with offers
  async getRequestDetails(req, res) {
    try {
      const { requestId } = req.params;
      const request = await CustomerRequest.getRequestWithOffers(requestId);

      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }

      res.json(request);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Accept an offer
  async acceptOffer(req, res) {
    try {
      const { offerId } = req.params;
      const offer = await pool.query(
        'SELECT * FROM customer_request_offers WHERE id = $1',
        [offerId],
      );

      if (!offer.rows[0]) {
        return res.status(404).json({ error: 'Offer not found' });
      }

      // Create planned task
      const plannedTask = await PlannedTask.create({
        request_id: offer.rows[0].request_id,
        tasker_id: offer.rows[0].tasker_id,
        customer_id: req.user.id,
        description: offer.rows[0].description,
        location: offer.rows[0].location,
        date: offer.rows[0].suggest_date,
        time: offer.rows[0].suggest_time,
      });

      // Update offer status
      await pool.query(
        'UPDATE customer_request_offers SET status = $1 WHERE id = $2',
        ['accepted', offerId],
      );
      
      res.status(201).json(plannedTask);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Decline an offer
  async declineOffer(req, res) {
    try {
      const { offerId } = req.params;
      const offer = await pool.query(
        'SELECT * FROM customer_request_offers WHERE id = $1',
        [offerId],
      );

      if (!offer.rows[0]) {
        return res.status(404).json({ error: 'Offer not found' });
      }

      // Update offer status
      await pool.query(
        'UPDATE customer_request_offers SET status = $1 WHERE id = $2',
        ['declined', offerId],
      );

      res.json({ message: 'Offer declined successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Accept a planned task (customer side)
  async acceptPlannedTask(req, res) {
    try {
      const { taskId } = req.params;
      const task = await PlannedTask.findById(taskId);

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (task.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to accept this task' });
      }

      const updatedTask = await PlannedTask.acceptTask(taskId, false);

      res.json(updatedTask);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create a review for a completed task
  async createReview(req, res) {
    try {
      const { taskId } = req.params;
      const { rating, review } = req.body;

      const task = await PlannedTask.findById(taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (task.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to review this task' });
      }

      if (task.status !== 'completed') {
        return res.status(400).json({ error: 'Can only review completed tasks' });
      }

      const newReview = await Review.createReview({
        planned_task_id: taskId,
        reviewer_id: req.user.id,
        reviewee_id: task.tasker_id,
        rating,
        review,
      });

      // Update tasker's rating
      await TaskerProfile.updateRating(task.tasker_id, rating);

      res.status(201).json(newReview);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get completed tasks
  async getCompletedTasks(req, res) {
    try {
      const query = `
        SELECT 
          pt.*,
          u.name as customer_name,
          t.name as tasker_name,
          cr.description as request_description,
          cr.budget
        FROM planned_tasks pt
        JOIN users u ON pt.customer_id = u.id
        JOIN users t ON pt.tasker_id = t.id
        JOIN customer_requests cr ON pt.request_id = cr.id
        WHERE pt.status = 'completed'
        ORDER BY pt.completed_at DESC
      `;

      const result = await pool.query(query);

      res.json({
        tasks: result.rows,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Update task status
  async updateTaskStatus(req, res) {
    try {
      const { taskId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }

      // Update task status
      const updatedTask = await TaskRequest.updateStatus(taskId, status);

      // If task is marked as completed, handle payment completion
      if (status === 'completed') {
        try {
          await paymentController.handleTaskCompletion(taskId);
        } catch (error) {
          console.error('Error handling payment completion:', error);
          // Don't fail the task status update if payment handling fails
        }
      }

      res.json(updatedTask);
    } catch (error) {
      console.error('Error updating task status:', error);
      res.status(500).json({ error: 'Failed to update task status' });
    }
  },

  // Create a new task request
  async createTask(req, res) {
    try {
      const {
        description,
        city_id,
        duration,
        tasker_id,
        hourly_rate,
      } = req.body;

      // Validate required fields
      if (!description || !city_id || !duration || !tasker_id || !hourly_rate) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Create task request
      const taskRequest = await TaskRequest.create({
        description,
        city_id,
        duration,
        sender_id: req.user.id,
        tasker_id,
        hourly_rate,
      });

      res.status(201).json(taskRequest);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Accept a task request
  async acceptTask(req, res) {
    try {
      const { taskId } = req.params;

      // Check if task exists
      const task = await TaskRequest.findById(taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // Check if user is the tasker
      if (task.tasker_id !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to accept this task' });
      }

      // Update task status
      const updatedTask = await TaskRequest.updateStatus(taskId, 'accepted');

      res.json(updatedTask);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get task by ID
  async getTaskById(req, res) {
    try {
      const { taskId } = req.params;
      const task = await TaskRequest.findById(taskId);

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      res.json(task);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
};

module.exports = taskController;
