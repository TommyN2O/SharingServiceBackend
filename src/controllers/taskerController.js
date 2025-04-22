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
      console.log('Creating tasker profile for user:', req.user.id);
      console.log('Request body:', req.body);

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
        console.log('Missing required fields:', {
          description: !!description,
          hourly_rate: !!hourly_rate,
          categories: !!categories,
          cities: !!cities,
          availability: !!availability
        });
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

      // Validate availability format
      if (!Array.isArray(availability) || !availability.every(slot => slot.date && slot.time)) {
        return res.status(400).json({
          error: 'Invalid availability format. Each slot must have date and time.',
          received: availability
        });
      }

      // Handle profile photo
      let finalProfilePhoto = profile_photo || 'images/profiles/default.jpg';

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        console.log('Transaction started');

        // Update user to become a tasker
        await User.becomeTasker(req.user.id);
        console.log('User updated to tasker');

        // Create tasker profile
        const taskerProfile = await TaskerProfile.create({
          user_id: req.user.id,
          profile_photo: finalProfilePhoto,
          description,
          hourly_rate: parseFloat(hourly_rate)
        });
        console.log('Tasker profile created:', taskerProfile);

        // Add categories
        if (Array.isArray(categories)) {
          for (const categoryId of categories) {
            await TaskerProfile.addCategory(taskerProfile.id, categoryId);
          }
          console.log('Categories added');
        }

        // Add cities
        if (Array.isArray(cities)) {
          for (const city of cities) {
            await TaskerProfile.addCity(taskerProfile.id, city);
          }
          console.log('Cities added');
        }

        // Add availability
        if (Array.isArray(availability)) {
          for (const slot of availability) {
            if (slot.date && slot.time) {
              // Ensure date is in YYYY-MM-DD format
              const formattedDate = new Date(slot.date).toISOString().split('T')[0];
              await TaskerProfile.addAvailability(taskerProfile.id, formattedDate, slot.time);
            }
          }
          console.log('Availability added');
        }

        await client.query('COMMIT');
        console.log('Transaction committed');

        // Get complete profile with all details
        const completeProfile = await TaskerProfile.getCompleteProfile(req.user.id);
        res.status(201).json(completeProfile);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in transaction, rolling back:', error);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating tasker profile:', error);
      res.status(500).json({ 
        error: 'Failed to create tasker profile',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // Update tasker profile
  async updateProfile(req, res) {
    try {
      console.log('Updating tasker profile for user:', req.user.id);
      console.log('Request body:', req.body);

      const {
        profile_photo,
        description,
        hourly_rate,
        categories,
        cities,
        availability
      } = req.body;

      // Check if user has a tasker profile
      const existingProfile = await TaskerProfile.findByUserId(req.user.id);
      if (!existingProfile) {
        return res.status(404).json({
          error: 'Tasker profile not found'
        });
      }

      // Update the profile
      const updatedProfile = await TaskerProfile.update(req.user.id, {
        profile_photo,
        description,
        hourly_rate,
        categories,
        cities,
        availability
      });

      res.json(updatedProfile);
    } catch (error) {
      console.error('Error updating tasker profile:', error);
      res.status(500).json({ 
        error: 'Failed to update tasker profile',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
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
  },

  // Get all tasker profiles
  async getAllProfiles(req, res) {
    try {
      console.log('Getting all tasker profiles');
      const profiles = await TaskerProfile.getAllProfiles();
      res.json(profiles);
    } catch (error) {
      console.error('Error getting all tasker profiles:', error);
      res.status(500).json({ error: 'Failed to get tasker profiles' });
    }
  },

  // Get tasker profile by ID
  async getProfileById(req, res) {
    try {
      const { id } = req.params;
      console.log('Getting tasker profile by ID:', id);
      
      const profile = await TaskerProfile.getProfileById(id);
      
      if (!profile) {
        return res.status(404).json({ error: 'Tasker profile not found' });
      }
      
      res.json(profile);
    } catch (error) {
      console.error('Error getting tasker profile by ID:', error);
      res.status(500).json({ error: 'Failed to get tasker profile' });
    }
  }
};

module.exports = taskerController; 