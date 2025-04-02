const TaskerProfile = require('../models/TaskerProfile');
const CustomerRequest = require('../models/CustomerRequest');
const PlannedTask = require('../models/PlannedTask');
const Message = require('../models/Message');
const User = require('../models/User');
const pool = require('../config/database');
const path = require('path');

const taskerController = {
  // Get tasker profile
  async getProfile(req, res) {
    try {
      // Get tasker profile with all details
      const profile = await TaskerProfile.getCompleteProfile(req.user.id);
      
      if (!profile) {
        return res.status(404).json({ error: 'Tasker profile not found' });
      }

      res.json(profile);
    } catch (error) {
      console.error('Error getting tasker profile:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Create tasker profile
  async createProfile(req, res) {
    try {
      const {
        profile_photo,
        description,
        hourly_rate,
        categories,
        cities,
        availability
      } = req.body;

      // Validate required fields
      if (!description || !hourly_rate || !categories || !cities || !availability) {
        return res.status(400).json({
          error: 'Missing required fields',
          received: {
            description: !!description,
            hourly_rate: !!hourly_rate,
            categories: !!categories,
            cities: !!cities,
            availability: !!availability
          }
        });
      }

      // Handle profile photo
      let finalProfilePhoto;
      if (profile_photo) {
        // If a custom photo is provided, use it
        finalProfilePhoto = profile_photo;
      } else {
        // Use default profile photo
        finalProfilePhoto = 'images/profiles/default.jpg';
      }

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update user to become a tasker
        await User.becomeTasker(req.user.id);

        // Create tasker profile
        const taskerProfile = await TaskerProfile.create({
          user_id: req.user.id,
          profile_photo: finalProfilePhoto,
          description,
          hourly_rate
        });

        // Add categories
        for (const categoryId of categories) {
          await TaskerProfile.addCategory(taskerProfile.id, categoryId);
        }

        // Add cities
        for (const city of cities) {
          await TaskerProfile.addCity(taskerProfile.id, city);
        }

        // Add availability
        for (const slot of availability) {
          await TaskerProfile.addAvailability(taskerProfile.id, slot.date, slot.time);
        }

        await client.query('COMMIT');

        // Get complete profile with all details
        const completeProfile = await TaskerProfile.getCompleteProfile(req.user.id);
        res.status(201).json(completeProfile);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating tasker profile:', error);
      res.status(500).json({ error: error.message });
    }
  },

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
  },

  // Delete tasker profile
  async deleteProfile(req, res) {
    try {
      const userId = req.user.id;
      
      // Check if user has a tasker profile
      const profile = await TaskerProfile.findByUserId(userId);
      if (!profile) {
        return res.status(404).json({ error: 'Tasker profile not found' });
      }

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Delete gallery images
        await client.query('DELETE FROM tasker_gallery WHERE tasker_id = $1', [userId]);

        // Delete availability
        await client.query('DELETE FROM tasker_availability WHERE tasker_id = $1', [userId]);

        // Delete cities
        await client.query('DELETE FROM tasker_cities WHERE tasker_id = $1', [userId]);

        // Delete categories
        await client.query('DELETE FROM tasker_categories WHERE tasker_id = $1', [userId]);

        // Delete the profile
        await client.query('DELETE FROM tasker_profiles WHERE user_id = $1', [userId]);

        // Update user's is_tasker status
        await client.query('UPDATE users SET is_tasker = false WHERE id = $1', [userId]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Tasker profile deleted successfully' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error deleting tasker profile:', error);
      res.status(500).json({ error: 'Failed to delete tasker profile' });
    }
  }
};

module.exports = taskerController; 