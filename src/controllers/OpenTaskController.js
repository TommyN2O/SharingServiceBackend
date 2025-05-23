const OpenTask = require('../models/OpenTask');
const pool = require('../config/database');

class OpenTaskController {
  constructor() {
    this.openTaskModel = new OpenTask();
    
    // Bind methods to ensure correct 'this' context
    this.createOpenTask = this.createOpenTask.bind(this);
    this.getAllOpenTasks = this.getAllOpenTasks.bind(this);
    this.getOpenTaskById = this.getOpenTaskById.bind(this);
    this.createOffer = this.createOffer.bind(this);
    this.acceptOffer = this.acceptOffer.bind(this);
    this.getTasksByCategory = this.getTasksByCategory.bind(this);
    this.getOpenTaskDates = this.getOpenTaskDates.bind(this);
    this.getTaskOffers = this.getTaskOffers.bind(this);
    this.getOfferById = this.getOfferById.bind(this);
    this.deleteOpenTask = this.deleteOpenTask.bind(this);
  }

  // Simple validation functions
  validateOpenTask(data) {
    const errors = [];
    
    if (!data.description || data.description.trim().length < 10) {
      errors.push('Description must be at least 10 characters long');
    }

    if (!data.budget || isNaN(data.budget) || data.budget < 0) {
      errors.push('Budget must be a positive number');
    }

    if (!data.duration || isNaN(data.duration) || data.duration < 0) {
      errors.push('Duration must be a positive number');
    }

    if (!data.location_id || isNaN(data.location_id)) {
      errors.push('Location is required');
    }

    if (!data.category_id || isNaN(data.category_id)) {
      errors.push('Category is required');
    }

    if (!Array.isArray(data.availability) || data.availability.length === 0) {
      errors.push('At least one availability slot must be provided');
    } else {
      for (const slot of data.availability) {
        if (!slot.date || !slot.time) {
          errors.push('Each availability slot must have both date and time');
          continue;
        }
        // Basic date validation
        if (!this.isValidDate(slot.date)) {
          errors.push(`Invalid date format for date: ${slot.date}. Use YYYY-MM-DD`);
        }
        // Basic time validation (HH:mm format)
        if (!this.isValidTime(slot.time.substring(0, 5))) {
          errors.push(`Invalid time format for time: ${slot.time}. Use HH:mm`);
        }
      }
    }

    return errors;
  }

  validateTaskOffer(data) {
    const errors = [];

    if (!data.description || data.description.trim().length < 10) {
      errors.push('Description must be at least 10 characters long');
    }

    if (!data.price || isNaN(data.price) || data.price < 0) {
      errors.push('Price must be a positive number');
    }

    if (!data.duration || isNaN(data.duration) || data.duration < 1 || !Number.isInteger(data.duration)) {
      errors.push('Duration must be a positive whole number (in hours)');
    }

    if (!data.availability || !data.availability.date || !this.isValidDate(data.availability.date)) {
      errors.push('Valid availability date is required (YYYY-MM-DD)');
    }

    if (!data.availability || !data.availability.time || !this.isValidTime(data.availability.time)) {
      errors.push('Valid availability time is required (HH:mm)');
    }

    return errors;
  }

  isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && date >= new Date();
  }

  isValidTime(timeString) {
    // Accept both HH:mm and HH:mm:ss formats
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(timeString);
  }

  // Create a new open task
  async createOpenTask(req, res) {
    try {
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      let taskData;
      try {
        // Handle the nested taskData structure
        if (req.body.taskData) {
          taskData = typeof req.body.taskData === 'string' 
            ? JSON.parse(req.body.taskData) 
            : req.body.taskData;
        } else {
          taskData = typeof req.body === 'string' 
            ? JSON.parse(req.body) 
            : req.body;
        }
        console.log('Parsed task data:', taskData);
      } catch (e) {
        console.error('Error parsing request body:', e);
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }

      const errors = this.validateOpenTask(taskData);
      if (errors.length > 0) {
        console.log('Validation errors:', errors);
        return res.status(400).json({ errors });
      }

      // Transform availability array format
      const dates = taskData.availability.map(slot => ({
        date: slot.date,
        time: slot.time
      }));
      console.log('Transformed dates:', dates);

      const finalTaskData = {
        description: taskData.description,
        budget: taskData.budget,
        duration: taskData.duration,
        location_id: taskData.location_id,
        category_id: taskData.category_id,
        creator_id: req.user.id,
        dates
      };
      console.log('Final task data:', finalTaskData);

      // Handle photos
      if (req.files && req.files.length > 0) {
        finalTaskData.photos = req.files.map(file => {
          // Extract just the filename from the full path
          const filename = file.filename || file.path.split('\\').pop().split('/').pop();
          return `images/tasks/${filename}`;
        });
        console.log('Added photos with correct path format:', finalTaskData.photos);
      }

      const task = await this.openTaskModel.create(finalTaskData);
      console.log('Created task:', task);
      res.status(201).json(task);
    } catch (error) {
      console.error('Detailed error creating open task:', error);
      res.status(500).json({ 
        error: 'Failed to create open task',
        details: error.message 
      });
    }
  }

  // Get all open tasks with filters
  async getAllOpenTasks(req, res) {
    try {
      console.log('Getting all open tasks with filters:', req.query);

      // Parse city IDs into an array if provided
      const cityIds = req.query.city ? req.query.city.split(',').map(id => parseInt(id)) : null;

      const filters = {
        category: req.query.category ? parseInt(req.query.category) : null,
        cityIds: cityIds,
        date: req.query.date ? req.query.date : null,
        minBudget: req.query.minBudget ? parseInt(req.query.minBudget) : null,
        maxBudget: req.query.maxBudget ? parseInt(req.query.maxBudget) : null,
        duration: req.query.duration ? parseInt(req.query.duration) : null,
        excludeUserId: req.query.excludeUserId ? parseInt(req.query.excludeUserId) : null,
        status: 'open'
      };

      console.log('Normalized filters:', filters);

      const tasks = await this.openTaskModel.getAll(filters);
      res.json(tasks);
    } catch (error) {
      console.error('Error getting open tasks:', error);
      res.status(500).json({ error: 'Failed to get open tasks' });
    }
  }

  // Get open task by ID
  async getOpenTaskById(req, res) {
    try {
      const task = await this.openTaskModel.getById(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    } catch (error) {
      console.error('Error getting open task:', error);
      res.status(500).json({ error: 'Failed to get open task' });
    }
  }

  // Create an offer for a task
  async createOffer(req, res) {
    try {
      const { taskId } = req.params;
      console.log('Full request body:', req.body);
      console.log('Request headers:', req.headers);
      
      const { description, price, availability, duration } = req.body;

      console.log('Parsed data:', {
        description,
        price,
        availability,
        duration
      });

      const errors = this.validateTaskOffer({
        description,
        price,
        duration,
        availability
      });
      
      if (errors.length > 0) {
        console.log('Validation errors:', errors);
        return res.status(400).json({ errors });
      }

      const dbOfferData = {
        task_id: taskId,
        tasker_id: req.user.id,
        description,
        hourly_rate: price,
        duration,
        preferred_date: availability.date,
        preferred_time: availability.time
      };

      console.log('DB offer data:', dbOfferData);

      const offer = await this.openTaskModel.createOffer(dbOfferData);
      
      // Format the response to match the Kotlin data class
      const formattedOffer = {
        id: offer.id,
        taskId: offer.task_id,
        description: offer.description,
        price: offer.hourly_rate,
        duration: offer.duration,
        availability: {
          date: offer.preferred_date,
          time: offer.preferred_time
        },
        status: offer.status
      };

      // Get task creator's ID and tasker's name
      const taskQuery = `
        SELECT ot.creator_id, u.name, u.surname
        FROM open_tasks ot
        JOIN users u ON u.id = $1
        WHERE ot.id = $2
      `;
      const taskResult = await pool.query(taskQuery, [req.user.id, taskId]);
      const { creator_id, name, surname } = taskResult.rows[0];

      // Send notification to task creator
      const FirebaseService = require('../services/firebaseService');
      await FirebaseService.sendTaskRequestNotification(
        req.user.id,
        creator_id,
        {
          id: taskId.toString(),
          title: '📋 New Offer Received',
          description: `${name} ${surname[0]}. has sent an offer for your open task.`,
          type: 'new_offer'
        }
      );

      res.status(201).json(formattedOffer);
    } catch (error) {
      console.error('Error creating offer:', error);
      res.status(500).json({ 
        error: 'Failed to create offer',
        details: error.message 
      });
    }
  }

  // Accept an offer
  async acceptOffer(req, res) {
    try {
      const { offerId } = req.params;
      const taskRequest = await this.openTaskModel.acceptOffer(offerId);
      res.json(taskRequest);
    } catch (error) {
      console.error('Error accepting offer:', error);
      res.status(500).json({ error: 'Failed to accept offer' });
    }
  }

  // Get tasks by category
  async getTasksByCategory(req, res) {
    try {
      const { categoryId } = req.params;
      
      if (!categoryId || isNaN(categoryId)) {
        return res.status(400).json({ error: 'Valid category ID is required' });
      }

      const tasks = await this.openTaskModel.getTasksByCategory(categoryId);
      res.json(tasks);
    } catch (error) {
      console.error('Error getting tasks by category:', error);
      res.status(500).json({ error: 'Failed to get tasks by category' });
    }
  }

  // Get dates for a specific open task
  async getOpenTaskDates(req, res) {
    try {
      const taskId = req.params.taskId;
      
      if (!taskId) {
        return res.status(400).json({ error: 'Task ID is required' });
      }

      const task = await this.openTaskModel.getById(taskId);
      
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // Return the availability array from the task object
      res.json({ availability: task.availability || [] });
    } catch (error) {
      console.error('Error getting open task dates:', error);
      res.status(500).json({ error: 'Failed to get task dates' });
    }
  }

  // Get all offers for a specific task
  async getTaskOffers(req, res) {
    try {
      const { taskId } = req.params;
      
      if (!taskId || isNaN(taskId)) {
        return res.status(400).json({ error: 'Valid task ID is required' });
      }

      const offers = await this.openTaskModel.getTaskOffers(taskId);
      console.log('Sending offers response:', JSON.stringify(offers, null, 2));
      res.json(offers);
    } catch (error) {
      console.error('Error getting task offers:', error);
      res.status(500).json({ error: 'Failed to get task offers' });
    }
  }

  // Get specific offer by ID
  async getOfferById(req, res) {
    try {
      const { offerId } = req.params;
      
      if (!offerId || isNaN(offerId)) {
        return res.status(400).json({ error: 'Valid offer ID is required' });
      }

      const offer = await this.openTaskModel.getOfferById(offerId);
      
      if (!offer) {
        return res.status(404).json({ error: 'Offer not found' });
      }

      res.json(offer);
    } catch (error) {
      console.error('Error getting offer:', error);
      res.status(500).json({ error: 'Failed to get offer' });
    }
  }

  // Delete an open task
  async deleteOpenTask(req, res) {
    try {
      const taskId = req.params.id;
      const userId = req.user.id;

      // Check if task exists and user is the creator
      const task = await this.openTaskModel.getById(taskId);
      
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (task.creator_id !== userId) {
        return res.status(403).json({ error: 'Not authorized to delete this task' });
      }

      // Delete the task
      await this.openTaskModel.delete(taskId);
      
      res.json({ message: 'Task deleted successfully' });
    } catch (error) {
      console.error('Error deleting open task:', error);
      res.status(500).json({ error: 'Failed to delete task' });
    }
  }
}

module.exports = OpenTaskController; 