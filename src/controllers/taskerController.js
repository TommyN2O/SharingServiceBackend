const TaskerProfile = require('../models/TaskerProfile');
const CustomerRequest = require('../models/CustomerRequest');
const PlannedTask = require('../models/PlannedTask');
const Message = require('../models/Message');

const taskerController = {
  // Create or update tasker profile
  async updateProfile(req, res) {
    try {
      const {
        bio,
        hourly_rate,
        skills,
        availability,
        location,
        verification_documents
      } = req.body;

      const taskerProfile = await TaskerProfile.createOrUpdate({
        user_id: req.user.id,
        bio,
        hourly_rate,
        skills,
        availability,
        location,
        verification_documents
      });

      res.json(taskerProfile);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get available tasks
  async getAvailableTasks(req, res) {
    try {
      const { category, location, minPrice, maxPrice } = req.query;
      const tasks = await CustomerRequest.findAvailable({
        category,
        location,
        minPrice,
        maxPrice
      });
      res.json(tasks);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Send offer for a task
  async sendOffer(req, res) {
    try {
      const { requestId, price, estimated_time, message } = req.body;
      
      // Check if user has a tasker profile
      const taskerProfile = await TaskerProfile.findByUserId(req.user.id);
      if (!taskerProfile) {
        return res.status(403).json({ error: 'Tasker profile required to send offers' });
      }

      const offer = await CustomerRequest.createOffer({
        request_id: requestId,
        tasker_id: req.user.id,
        price,
        estimated_time,
        message
      });

      // Send notification to customer
      const request = await CustomerRequest.findById(requestId);
      await Message.create({
        sender_id: req.user.id,
        receiver_id: request.user_id,
        content: `New offer received for your task: ${request.title}`,
        type: 'notification'
      });

      res.status(201).json(offer);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Accept a task
  async acceptTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Check if user has a tasker profile
      const taskerProfile = await TaskerProfile.findByUserId(req.user.id);
      if (!taskerProfile) {
        return res.status(403).json({ error: 'Tasker profile required to accept tasks' });
      }

      const task = await PlannedTask.acceptTask(taskId, req.user.id);
      
      // Send notification to customer
      await Message.create({
        sender_id: req.user.id,
        receiver_id: task.customer_id,
        content: `Tasker has accepted your task: ${task.title}`,
        type: 'notification'
      });

      res.json(task);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get tasker's tasks
  async getTasks(req, res) {
    try {
      const { status } = req.query;
      const tasks = await PlannedTask.findByTaskerId(req.user.id, status);
      res.json(tasks);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Update task status
  async updateTaskStatus(req, res) {
    try {
      const { taskId } = req.params;
      const { status } = req.body;

      const task = await PlannedTask.updateStatus(taskId, status);
      
      // Send notification to customer about status change
      await Message.create({
        sender_id: req.user.id,
        receiver_id: task.customer_id,
        content: `Task status updated to: ${status}`,
        type: 'notification'
      });

      res.json(task);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};

module.exports = taskerController; 