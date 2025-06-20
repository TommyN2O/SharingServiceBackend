const path = require('path');
const multer = require('multer');
const fs = require('fs');
const TaskerProfile = require('../models/TaskerProfile');
const TaskRequest = require('../models/TaskRequest');
const Message = require('../models/Message');
const User = require('../models/User');
const pool = require('../config/database');
const Payment = require('../models/Payment');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination(req, file, cb) {
    // Check if the field is for gallery images
    const folder = file.fieldname === 'galleryImages' || file.fieldname === 'gallery' ? 'gallery' : 'profiles';
    const dir = path.join('public', 'images', folder);
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename(req, file, cb) {
    // Generate unique filename with original extension
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname) || '.jpg'; // Default to .jpg if no extension
    cb(null, uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images and handle content type from Android
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Middleware for handling multiple file uploads
const uploadFields = upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }, // Add support for profile_photo field
  { name: 'galleryImages', maxCount: 10 },
  { name: 'gallery', maxCount: 10 }, // Add support for gallery field
]);

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
      console.log('Files received:', req.files);

      // Parse the tasker profile JSON data
      let taskerProfileData;
      try {
        taskerProfileData = JSON.parse(req.body.tasker_profile_json);
        console.log('Parsed tasker profile data:', taskerProfileData);
      } catch (error) {
        console.error('Error parsing tasker profile JSON:', error);
        return res.status(400).json({
          error: 'Invalid tasker profile JSON',
          details: error.message,
        });
      }

      const {
        description,
        hourly_rate,
        categories,
        cities,
        availability = [],
      } = taskerProfileData;

      // Validate required fields
      if (!description || !hourly_rate || !categories?.length || !cities?.length) {
        return res.status(400).json({
          error: 'Missing required fields',
          received: {
            description: !!description,
            hourly_rate: !!hourly_rate,
            categories: categories?.length > 0,
            cities: cities?.length > 0,
          },
        });
      }

      // Handle profile photo (check both field names)
      let finalProfilePhoto = null;
      if (req.files) {
        const profilePhotoFile = req.files.profileImage?.[0] || req.files.profile_photo?.[0];
        if (profilePhotoFile) {
          console.log('Profile photo file received:', profilePhotoFile);
          finalProfilePhoto = `images/profiles/${profilePhotoFile.filename}`;
        }
      }

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
          hourly_rate: parseFloat(hourly_rate),
        });
        console.log('Tasker profile created:', taskerProfile);

        // Add categories
        for (const category of categories) {
          const categoryId = typeof category === 'object' ? category.id : category;
          await TaskerProfile.addCategory(taskerProfile.id, categoryId);
        }
        console.log('Categories added:', categories);

        // Add cities
        for (const city of cities) {
          const cityId = typeof city === 'object' ? city.id : city;
          await TaskerProfile.addCity(taskerProfile.id, cityId);
        }
        console.log('Cities added:', cities);

        // Add availability if any exists
        if (Array.isArray(availability) && availability.length > 0) {
          for (const slot of availability) {
            if (slot.date && slot.time) {
              // Ensure date is in YYYY-MM-DD format
              const formattedDate = new Date(slot.date).toISOString().split('T')[0];
              await TaskerProfile.addAvailability(taskerProfile.id, formattedDate, slot.time);
            }
          }
          console.log('Availability added:', availability);
        }

        // Add gallery photos (check both field names)
        if (req.files) {
          const galleryFiles = [...(req.files.galleryImages || []), ...(req.files.gallery || [])];
          for (const file of galleryFiles) {
            console.log('Gallery photo file:', file);
            const imageUrl = `images/gallery/${file.filename}`;
            await TaskerProfile.addGalleryPhoto(taskerProfile.id, imageUrl);
          }
          console.log('Gallery photos added');
        }

        await client.query('COMMIT');
        console.log('Transaction committed');

        // Get complete profile with all details
        const completeProfile = await TaskerProfile.getCompleteProfile(req.user.id);
        res.status(201).json(completeProfile);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in transaction, rolling back:', error);

        // Clean up uploaded files in case of error
        if (req.files) {
          Object.values(req.files).flat().forEach((file) => {
            if (file.path) {
              fs.unlink(file.path, (err) => {
                if (err) console.error('Error deleting file:', err);
              });
            }
          });
        }

        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating tasker profile:', error);
      res.status(500).json({
        error: 'Failed to create tasker profile',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Update tasker profile
  async updateProfile(req, res) {
    try {
      console.log('Updating tasker profile for user:', req.user.id);
      console.log('Request body:', req.body);
      console.log('Files received:', req.files);

      // Parse the tasker profile JSON data
      let taskerProfileData;
      try {
        taskerProfileData = JSON.parse(req.body.tasker_profile_json);
        console.log('Parsed tasker profile data:', taskerProfileData);
      } catch (error) {
        console.error('Error parsing tasker profile JSON:', error);
        return res.status(400).json({
          error: 'Invalid tasker profile JSON',
          details: error.message,
        });
      }

      const {
        description,
        hourly_rate,
        categories,
        cities,
        availability = [],
        deletedGalleryImages = [], // Array of image URLs to delete
      } = taskerProfileData;

      // Check if user has a tasker profile
      const existingProfile = await TaskerProfile.findByUserId(req.user.id);
      if (!existingProfile) {
        return res.status(404).json({
          error: 'Tasker profile not found',
        });
      }

      // Handle profile photo update
      let finalProfilePhoto = existingProfile.profile_photo;
      if (req.files && (req.files.profileImage?.[0] || req.files.profile_photo?.[0])) {
        const profilePhotoFile = req.files.profileImage?.[0] || req.files.profile_photo?.[0];
        console.log('New profile photo file received:', profilePhotoFile);

        // Delete old profile photo if it exists
        if (finalProfilePhoto) {
          const oldPhotoPath = path.join('public', finalProfilePhoto);
          if (fs.existsSync(oldPhotoPath)) {
            fs.unlinkSync(oldPhotoPath);
          }
        }

        finalProfilePhoto = `images/profiles/${profilePhotoFile.filename}`;
      }

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Delete gallery images if specified
        if (Array.isArray(deletedGalleryImages) && deletedGalleryImages.length > 0) {
          console.log('Deleting gallery images:', deletedGalleryImages);

          // Extract relative paths from URLs or full paths
          const dbImageUrls = deletedGalleryImages.map((url) => {
            // Remove domain and port if it's a full URL
            const urlMatch = url.match(/\/images\/gallery\/[^?#]+/);
            if (urlMatch) {
              // Extract just the /gallery/filename.jpg part
              return urlMatch[0].replace(/^\/images\//, '');
            }
            // If not a URL, just remove the images/ prefix if it exists
            return url.replace(/^images\//, '');
          });

          // Delete from database using the relative paths
          const placeholders = dbImageUrls.map((_, idx) => `$${idx + 2}`).join(',');
          await client.query(
            `DELETE FROM tasker_gallery 
             WHERE tasker_id = $1 
             AND image_url = ANY(ARRAY[${placeholders}])`,
            [existingProfile.id, ...dbImageUrls],
          );

          // Delete files from filesystem
          for (const relativePath of dbImageUrls) {
            const imagePath = path.join('public', 'images', relativePath);
            console.log('Attempting to delete file:', imagePath);

            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
              console.log('Successfully deleted file:', imagePath);
            } else {
              console.log('File not found:', imagePath);
            }
          }
        }

        // Update the main profile
        const _updatedProfile = await TaskerProfile.update(req.user.id, {
          profile_photo: finalProfilePhoto,
          description,
          hourly_rate: parseFloat(hourly_rate),
          categories,
          cities,
          availability,
        });

        // Handle new gallery images if provided
        if (req.files && (req.files.galleryImages || req.files.gallery)) {
          const galleryFiles = [...(req.files.galleryImages || []), ...(req.files.gallery || [])];
          for (const galleryImage of galleryFiles) {
            const imageUrl = `images/gallery/${galleryImage.filename}`;
            await TaskerProfile.addGalleryPhoto(existingProfile.id, imageUrl);
          }
        }

        await client.query('COMMIT');

        // Get the complete updated profile
        const completeProfile = await TaskerProfile.getCompleteProfile(req.user.id);
        res.json(completeProfile);
      } catch (error) {
        await client.query('ROLLBACK');
        // Clean up any newly uploaded files in case of error
        if (req.files) {
          Object.values(req.files).flat().forEach((file) => {
            if (file.path) {
              fs.unlink(file.path, (err) => {
                if (err) console.error('Error deleting file:', err);
              });
            }
          });
        }
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating tasker profile:', error);
      res.status(500).json({
        error: 'Failed to update tasker profile',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get available tasks
  async getAvailableTasks(req, res) {
    try {
      const {
        category, location, minPrice, maxPrice,
      } = req.query;
      const tasks = await TaskRequest.findAvailable({
        category,
        location,
        minPrice,
        maxPrice,
      });
      res.json(tasks);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Send offer for a task
  async sendOffer(req, res) {
    try {
      const {
        requestId, price, estimated_time, message,
      } = req.body;

      // Check if user has a tasker profile
      const taskerProfile = await TaskerProfile.findByUserId(req.user.id);
      if (!taskerProfile) {
        return res.status(403).json({ error: 'Tasker profile required to send offers' });
      }

      const offer = await TaskRequest.createOffer({
        request_id: requestId,
        tasker_id: req.user.id,
        price,
        estimated_time,
        message,
      });

      // Send notification to customer
      const request = await TaskRequest.findById(requestId);
      await Message.create({
        sender_id: req.user.id,
        receiver_id: request.user_id,
        content: `New offer received for your task: ${request.title}`,
        type: 'notification',
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

      const task = await TaskRequest.acceptTask(taskId, req.user.id);

      // Send notification to customer
      await Message.create({
        sender_id: req.user.id,
        receiver_id: task.customer_id,
        content: `Tasker has accepted your task: ${task.title}`,
        type: 'notification',
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
      const tasks = await TaskRequest.findByTaskerId(req.user.id, status);
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
      const task = await TaskRequest.updateStatus(taskId, status);
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

        // Check for active tasks (pending, accepted, paid, or in progress)
        const activeTasksQuery = `
          SELECT COUNT(*) as count
          FROM task_requests
          WHERE tasker_id = $1
          AND status IN ('pending', 'Waiting for Payment', 'paid')
        `;
        const activeTasksResult = await client.query(activeTasksQuery, [userId]);

        if (activeTasksResult.rows[0].count > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Cannot delete profile while having active tasks. Please complete or cancel all active tasks first.',
          });
        }

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

  // Helper function to remove expired availability slots
  async removeExpiredAvailability(client, taskerId = null) {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const currentTime = new Date().toTimeString().split(' ')[0];

      let query = `
        DELETE FROM tasker_availability 
        WHERE (date < $1) 
        OR (date = $1 AND time_slot < $2)
      `;

      const params = [currentDate, currentTime];

      // If taskerId is provided, only remove for that tasker
      if (taskerId) {
        query += ' AND tasker_id = $3';
        params.push(taskerId);
      }

      await client.query(query, params);
    } catch (error) {
      console.error('Error removing expired availability:', error);
    }
  },

  // Get all tasker profiles
  async getAllProfiles(req, res) {
    try {
      console.log('Getting all tasker profiles with filters:', req.query);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Remove expired availability slots
        const currentDate = new Date().toISOString().split('T')[0];
        const currentTime = new Date().toTimeString().split(' ')[0];

        await client.query(`
          DELETE FROM tasker_availability 
          WHERE (date < $1) 
          OR (date = $1 AND time_slot < $2)
        `, [currentDate, currentTime]);

        const filters = {
          category: req.query.category ? parseInt(req.query.category) : null,
          rating: req.query.rating ? req.query.rating : null,
          city: req.query.city ? req.query.city : null,
          date: req.query.date ? req.query.date : null,
          timeFrom: req.query.timeFrom ? req.query.timeFrom : null,
          timeTo: req.query.timeTo ? req.query.timeTo : null,
          minPrice: req.query.minPrice ? parseFloat(req.query.minPrice) : null,
          maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice) : null,
          excludeUserId: req.user.id, // Add user ID to exclude their own profile
        };

        const profiles = await TaskerProfile.getAllProfiles(filters);

        await client.query('COMMIT');
        res.json(profiles);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Remove expired availability slots
        const currentDate = new Date().toISOString().split('T')[0];
        const currentTime = new Date().toTimeString().split(' ')[0];

        await client.query(`
          DELETE FROM tasker_availability 
          WHERE (date < $1) 
          OR (date = $1 AND time_slot < $2)
          AND tasker_id = $3
        `, [currentDate, currentTime, id]);

        const profile = await TaskerProfile.getProfileById(id);

        if (!profile) {
          return res.status(404).json({ error: 'Tasker profile not found' });
        }

        await client.query('COMMIT');
        res.json(profile);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting tasker profile by ID:', error);
      res.status(500).json({ error: 'Failed to get tasker profile' });
    }
  },

  // Cleanup expired availability (can be called periodically)
  async cleanupExpiredAvailability(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await this.removeExpiredAvailability(client);

      await client.query('COMMIT');
      res.json({ message: 'Successfully cleaned up expired availability slots' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error cleaning up expired availability:', error);
      res.status(500).json({ error: 'Failed to cleanup expired availability' });
    } finally {
      client.release();
    }
  },

  // Update tasker availability
  async updateAvailability(req, res) {
    try {
      console.log('Updating availability for user:', req.user.id);
      console.log('Request body:', JSON.stringify(req.body, null, 2));

      // Check if user has a tasker profile
      const existingProfile = await TaskerProfile.findByUserId(req.user.id);
      if (!existingProfile) {
        return res.status(404).json({
          error: 'Tasker profile not found',
        });
      }

      const { availability } = req.body;

      // Validate availability data
      if (!Array.isArray(availability)) {
        return res.status(400).json({
          error: 'Invalid availability format. Expected an array of availability slots.',
          received: availability,
        });
      }

      // Validate each slot has date and time in correct format
      for (const slot of availability) {
        if (!slot || typeof slot !== 'object') {
          return res.status(400).json({
            error: 'Each availability slot must be an object',
            invalidSlot: slot,
          });
        }

        if (!slot.date || !slot.time) {
          return res.status(400).json({
            error: 'Each availability slot must have date and time properties',
            invalidSlot: slot,
          });
        }

        // Validate date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
          return res.status(400).json({
            error: 'Date must be in YYYY-MM-DD format (e.g. 2024-03-20)',
            invalidDate: slot.date,
          });
        }

        // Validate time format (HH:mm:ss)
        if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(slot.time)) {
          return res.status(400).json({
            error: 'Time must be in HH:mm:ss format (e.g. 14:30:00)',
            invalidTime: slot.time,
          });
        }

        // Validate that date is not in the past
        const slotDate = new Date(`${slot.date}T${slot.time}`);
        const now = new Date();
        if (slotDate < now) {
          return res.status(400).json({
            error: 'Cannot set availability for past dates',
            invalidSlot: slot,
          });
        }
      }

      try {
      // Use the TaskerProfile update method
        const updatedProfile = await TaskerProfile.update(req.user.id, {
          availability,
        });

        // Send success response with updated profile
        res.status(200).json({
          message: 'Availability updated successfully',
          profile: updatedProfile,
        });
      } catch (error) {
        console.error('Error updating availability:', error);
        return res.status(500).json({
          error: 'Failed to update availability',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
      }
    } catch (error) {
      console.error('Error in updateAvailability:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Send task request with gallery images
  async sendTaskRequest(req, res) {
    const client = await pool.connect();
    try {
      console.log('Receiving task request with files:', req.files);
      console.log('Request body:', req.body);

      // Parse the task request JSON data
      let taskRequestData;
      try {
        taskRequestData = JSON.parse(req.body.taskData);
        console.log('Parsed task request data:', taskRequestData);
      } catch (error) {
        console.error('Error parsing task request JSON:', error);
        return res.status(400).json({
          error: 'Invalid task request JSON',
          details: error.message,
        });
      }

      const {
        description,
        city,
        categories,
        duration,
        availability,
        sender_id,
        tasker_id, // This is now the tasker_profile.id
      } = taskRequestData;

      // Start a transaction
      await client.query('BEGIN');
      console.log('Transaction started');

      // First get the user_id from tasker_profiles
      const taskerProfileQuery = `
        SELECT tp.user_id, u.is_tasker, tp.*, u.name, u.surname
        FROM tasker_profiles tp
        JOIN users u ON tp.user_id = u.id
        WHERE tp.id = $1
      `;
      const taskerProfileResult = await client.query(taskerProfileQuery, [tasker_id]);

      if (taskerProfileResult.rows.length === 0) {
        throw new Error('Tasker profile not found');
      }

      const taskerProfile = taskerProfileResult.rows[0];
      const taskerUserId = taskerProfile.user_id;
      const isTasker = taskerProfile.is_tasker;

      if (!isTasker) {
        throw new Error('Selected user is not a tasker');
      }

      // Check if sender exists
      const senderQuery = `
        SELECT 
          u.id,
          u.name,
          u.surname,
          COALESCE(u.profile_photo, '') as sender_profile_photo
        FROM users u
        WHERE u.id = $1
      `;
      const senderResult = await client.query(senderQuery, [sender_id]);

      if (senderResult.rows.length === 0) {
        throw new Error('Sender not found');
      }
      const sender = senderResult.rows[0];

      // Create the task request
      const taskRequestQuery = `
        INSERT INTO task_requests (
          description,
          city_id,
          duration,
          sender_id,
          tasker_id,
          status,
          created_at,
          hourly_rate
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), $6)
        RETURNING id, created_at
      `;

      const taskRequestResult = await client.query(taskRequestQuery, [
        description,
        city.id,
        duration,
        sender_id,
        taskerUserId, // Use the user_id we got from tasker_profiles
        taskerProfile.hourly_rate, // Add the tasker's hourly rate from their profile
      ]);

      const taskRequestId = taskRequestResult.rows[0].id;
      console.log('Created task request with ID:', taskRequestId);

      // Add categories
      for (const category of categories) {
        await client.query(
          `INSERT INTO task_request_categories (task_request_id, category_id)
           VALUES ($1, $2)`,
          [taskRequestId, category.id],
        );
      }
      console.log('Added categories');

      // Add availability slot
      const slot = availability[0]; // We only use the first slot
      const formattedDate = new Date(slot.date).toISOString().split('T')[0];
      await client.query(
        `INSERT INTO task_request_availability (task_request_id, date, time_slot)
         VALUES ($1, $2, $3)`,
        [taskRequestId, formattedDate, slot.time],
      );
      console.log('Added availability');

      // Handle gallery images if provided
      const galleryUrls = [];
      if (req.files?.galleryImages) {
        for (const file of req.files.galleryImages) {
          const imageUrl = `images/gallery/${file.filename}`;
          await client.query(
            `INSERT INTO task_request_gallery (task_request_id, image_url)
             VALUES ($1, $2)`,
            [taskRequestId, imageUrl],
          );
          galleryUrls.push(imageUrl);
        }
        console.log('Added gallery images');
      }

      // Remove notification message creation since it's not needed right now
      await client.query('COMMIT');
      console.log('Transaction committed successfully');

      // Send Firebase notification to tasker
      const FirebaseService = require('../services/firebaseService');
      await FirebaseService.sendTaskRequestNotification(
        sender_id,
        taskerUserId,
        {
          id: taskRequestId.toString(),
          title: '📋 Nauja užklausa',
          description: `Nauja darbo užklausa ${city.name} mieste: ${categories.map((cat) => cat.name).join(', ')}`,
          type: 'new_task',
          categories: JSON.stringify(categories.map((cat) => ({ id: cat.id.toString(), name: cat.name }))),
          city: JSON.stringify({ id: city.id.toString(), name: city.name }),
        },
      );

      // Prepare the response object
      const response = {
        id: taskRequestId,
        description,
        city: {
          id: city.id,
          name: city.name,
          created_at: city.created_at,
        },
        categories: categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          description: cat.description,
          image_url: cat.image_url,
          created_at: cat.created_at,
        })),
        duration,
        availability: [{
          date: formattedDate,
          time: slot.time,
        }],
        sender: {
          id: sender.id,
          name: sender.name,
          surname: sender.surname,
          profile_photo: sender.sender_profile_photo,
        },
        tasker: {
          id: taskerProfile.id,
          name: taskerProfile.name,
          surname: taskerProfile.surname,
          profile_photo: taskerProfile.profile_photo,
          description: taskerProfile.description,
          hourly_rate: taskerProfile.hourly_rate,
        },
        gallery: galleryUrls,
        status: 'pending',
        created_at: taskRequestResult.rows[0].created_at,
      };

      res.status(201).json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in transaction, rolling back:', error);

      // Clean up any uploaded files in case of error
      if (req.files?.galleryImages) {
        req.files.galleryImages.forEach((file) => {
          if (file.path) {
            fs.unlink(file.path, (err) => {
              if (err) console.error('Error deleting file:', err);
            });
          }
        });
      }

      // Return appropriate error message with more detail
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: error.message,
        });
      } if (error.message.includes('not a tasker')) {
        return res.status(400).json({
          error: error.message,
        });
      }

      res.status(500).json({
        error: 'Failed to send task request',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      client.release();
      console.log('Database client released');
    }
  },

  // Get tasks sent by sender
  async getTasksBySender(req, res) {
    try {
      const sender_id = req.user.id;
      console.log('Getting tasks for sender ID:', sender_id);

      // Parse filters from query parameters
      const categoryIds = req.query.category ? req.query.category.split(',').map((id) => parseInt(id)) : null;
      const cityIds = req.query.city ? req.query.city.split(',').map((id) => parseInt(id)) : null;
      const date = req.query.date || null;
      const status = req.query.status ? req.query.status.toLowerCase() : null; // Convert status to lowercase

      console.log('Filters:', {
        categoryIds, cityIds, date, status,
      });

      const client = await pool.connect();
      try {
        // Debug: Check if tables exist and have data
        const tableChecks = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM task_requests) as total_requests,
            (SELECT COUNT(*) FROM task_requests WHERE sender_id = $1) as user_requests,
            (SELECT COUNT(*) FROM open_tasks WHERE creator_id = $1) as user_open_tasks,
            (SELECT COUNT(*) FROM users WHERE id = $1) as user_exists
        `, [sender_id]);

        console.log('Database status:', {
          totalRequests: tableChecks.rows[0].total_requests,
          userRequests: tableChecks.rows[0].user_requests,
          userOpenTasks: tableChecks.rows[0].user_open_tasks,
          userExists: tableChecks.rows[0].user_exists,
        });

        const query = `
          -- Task Requests
          SELECT 
            'task_request' as task_type,
            tr.id,
            tr.description,
            tr.duration,
            tr.status,
            tr.created_at,
            tr.is_open_task,
            tr.open_task_id,
            NULL::decimal as budget,
            c.id as city_id,
            c.name as city_name,
            -- Categories as JSON array
            (
              SELECT json_agg(json_build_object(
                'id', cat.id,
                'name', cat.name,
                'description', cat.description,
                'image_url', cat.image_url
              ))
              FROM task_request_categories trc
              JOIN categories cat ON trc.category_id = cat.id
              WHERE trc.task_request_id = tr.id
            ) as categories,
            -- Availability as JSON array
            (
              SELECT json_agg(json_build_object(
                'date', to_char(tra.date, 'YYYY-MM-DD'),
                'time', to_char(tra.time_slot, 'HH24:MI:SS')
              ))
              FROM task_request_availability tra
              WHERE tra.task_request_id = tr.id
            ) as availability,
            -- Sender details
            s.id as sender_id,
            s.name as sender_name,
            s.surname as sender_surname,
            COALESCE(s.profile_photo, '') as sender_profile_photo,
            -- Tasker details
            t.id as tasker_id,
            t.name as tasker_name,
            t.surname as tasker_surname,
            COALESCE(tp.profile_photo, '') as tasker_profile_photo,
            tp.description as tasker_description,
            tr.hourly_rate as tasker_hourly_rate,
            -- Gallery as JSON array with relative paths and forward slashes
            COALESCE(
            (
                SELECT json_agg(
                  CASE 
                    WHEN trg.image_url LIKE 'C:%' OR trg.image_url LIKE '/C:%' 
                    THEN replace(regexp_replace(trg.image_url, '^.*?public[/\\\\]', ''), '\\', '/')
                    ELSE replace(trg.image_url, '\\', '/')
                  END
                )
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
              ),
              '[]'::json
            ) as gallery
          FROM task_requests tr
          JOIN cities c ON tr.city_id = c.id
          JOIN users s ON tr.sender_id = s.id
          JOIN users t ON tr.tasker_id = t.id
          LEFT JOIN tasker_profiles tp ON t.id = tp.user_id
          WHERE tr.sender_id = $1
          ${status ? 'AND LOWER(tr.status) = $2' : ''}
          ${categoryIds ? `AND EXISTS (
            SELECT 1 FROM task_request_categories trc 
            WHERE trc.task_request_id = tr.id 
            AND trc.category_id = ANY($${status ? 3 : 2}::integer[])
          )` : ''}
          ${cityIds ? `AND c.id = ANY($${status ? categoryIds ? 4 : 3 : categoryIds ? 3 : 2}::integer[])` : ''}
          ${date ? `AND EXISTS (
            SELECT 1 FROM task_request_availability tra 
            WHERE tra.task_request_id = tr.id 
            AND tra.date = $${status ? categoryIds ? cityIds ? 5 : 4 : 4 : categoryIds ? cityIds ? 4 : 3 : cityIds ? 3 : 2}::date
          )` : ''}

          UNION ALL

          -- Open Tasks
          SELECT 
            'open_task' as task_type,
            ot.id,
            ot.description,
            ot.duration,
            ot.status,
            ot.created_at,
            false as is_open_task,
            NULL::integer as open_task_id,
            ot.budget,
            c.id as city_id,
            c.name as city_name,
            -- Categories
            json_build_array(
              json_build_object(
                'id', cat.id,
                'name', cat.name,
                'description', cat.description,
                'image_url', cat.image_url
              )
            ) as categories,
            -- Availability
            (
              SELECT json_agg(json_build_object(
                'date', to_char(otd.date, 'YYYY-MM-DD'),
                'time', to_char(otd.time, 'HH24:MI:SS')
              ))
              FROM open_task_dates otd
              WHERE otd.task_id = ot.id
            ) as availability,
            -- Sender (creator) details
            s.id as sender_id,
            s.name as sender_name,
            s.surname as sender_surname,
            COALESCE(s.profile_photo, '') as sender_profile_photo,
            -- Tasker details (null for open tasks)
            NULL as tasker_id,
            NULL as tasker_name,
            NULL as tasker_surname,
            NULL as tasker_profile_photo,
            NULL as tasker_description,
            NULL::decimal as tasker_hourly_rate,
            -- Gallery
            COALESCE(
              (
                SELECT json_agg(
                  CASE 
                    WHEN otp.photo_url LIKE 'C:%' OR otp.photo_url LIKE '/C:%' 
                    THEN replace(regexp_replace(otp.photo_url, '^.*?public[/\\\\]', ''), '\\', '/')
                    ELSE replace(otp.photo_url, '\\', '/')
                  END
                )
                FROM open_task_photos otp
                WHERE otp.task_id = ot.id
              ),
              '[]'::json
            ) as gallery
          FROM open_tasks ot
          JOIN cities c ON ot.location_id = c.id
          JOIN categories cat ON ot.category_id = cat.id
          JOIN users s ON ot.creator_id = s.id
          WHERE ot.creator_id = $1
          ${status ? 'AND LOWER(ot.status) = $2' : ''}
          ${categoryIds ? `AND ot.category_id = ANY($${status ? 3 : 2}::integer[])` : ''}
          ${cityIds ? `AND c.id = ANY($${status ? categoryIds ? 4 : 3 : categoryIds ? 3 : 2}::integer[])` : ''}
          ${date ? `AND EXISTS (
            SELECT 1 FROM open_task_dates otd 
            WHERE otd.task_id = ot.id 
            AND otd.date = $${status ? categoryIds ? cityIds ? 5 : 4 : 4 : categoryIds ? cityIds ? 4 : 3 : cityIds ? 3 : 2}::date
          )` : ''}
          AND NOT EXISTS (
            SELECT 1 
            FROM task_requests tr 
            WHERE tr.open_task_id = ot.id 
            AND tr.is_open_task = true
          )

          ORDER BY created_at DESC
        `;

        // Build parameters array
        const params = [sender_id];
        if (status) params.push(status);
        if (categoryIds) params.push(categoryIds);
        if (cityIds) params.push(cityIds);
        if (date) params.push(date);

        console.log('Query parameters:', params);

        const result = await client.query(query, params);
        console.log(`Found ${result.rows.length} total tasks for user ${sender_id}`);

        // Format the response
        const tasks = result.rows.map((row) => ({
          task_type: row.task_type,
          id: row.id,
          description: row.description,
          city: {
            id: row.city_id,
            name: row.city_name,
          },
          categories: row.categories || [],
          duration: row.duration,
          availability: row.availability || [],
          sender: {
            id: row.sender_id,
            name: row.sender_name,
            surname: row.sender_surname,
            profile_photo: row.sender_profile_photo,
          },
          tasker: row.tasker_id ? {
            id: row.tasker_id,
            name: row.tasker_name,
            surname: row.tasker_surname,
            profile_photo: row.tasker_profile_photo,
            description: row.tasker_description,
            hourly_rate: row.tasker_hourly_rate,
          } : null,
          gallery: row.gallery || [],
          status: row.status,
          created_at: row.created_at,
          budget: row.budget,
          is_open_task: row.is_open_task,
          open_task_id: row.open_task_id,
        }));

        // Debug: Log sample task if available
        if (tasks.length > 0) {
          console.log('Sample task:', JSON.stringify(tasks[0], null, 2));
        } else {
          console.log('No tasks found for this user');
        }

        res.json(tasks);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting tasks by sender:', error);
      res.status(500).json({
        error: 'Failed to get tasks',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get task requests received by tasker
  async getTaskRequestsReceived(req, res) {
    try {
      const tasker_id = req.user.id;
      console.log('Getting task requests for tasker ID:', tasker_id);

      // Parse filters from query parameters
      const categoryIds = req.query.category ? req.query.category.split(',').map((id) => parseInt(id)) : null;
      const cityIds = req.query.city ? req.query.city.split(',').map((id) => parseInt(id)) : null;
      const date = req.query.date || null;
      const status = req.query.status ? req.query.status.toLowerCase() : null;

      console.log('Filters:', {
        categoryIds, cityIds, date, status,
      });

      const client = await pool.connect();
      try {
        // Debug: Check if tables exist and have data
        const tableChecks = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM task_requests) as total_requests,
            (SELECT COUNT(*) FROM task_requests WHERE tasker_id = $1) as tasker_requests,
            (SELECT COUNT(*) FROM users WHERE id = $1) as user_exists
        `, [tasker_id]);

        console.log('Database status:', {
          totalRequests: tableChecks.rows[0].total_requests,
          taskerRequests: tableChecks.rows[0].tasker_requests,
          userExists: tableChecks.rows[0].user_exists,
        });

        // Get all task requests with related data
        const query = `
          SELECT 
            tr.id,
            tr.description,
            tr.duration,
            tr.status,
            tr.created_at,
            c.id as city_id,
            c.name as city_name,
            -- Categories as JSON array
            (
              SELECT json_agg(json_build_object(
                'id', cat.id,
                'name', cat.name,
                'description', cat.description,
                'image_url', cat.image_url
              ))
              FROM task_request_categories trc
              JOIN categories cat ON trc.category_id = cat.id
              WHERE trc.task_request_id = tr.id
            ) as categories,
            -- Availability as JSON array
            (
              SELECT json_agg(json_build_object(
                'date', to_char(tra.date, 'YYYY-MM-DD'),
                'time', to_char(tra.time_slot, 'HH24:MI:SS')
              ))
              FROM task_request_availability tra
              WHERE tra.task_request_id = tr.id
            ) as availability,
            -- Sender details
            s.id as sender_id,
            s.name as sender_name,
            s.surname as sender_surname,
            COALESCE(s.profile_photo, '') as sender_profile_photo,
            -- Tasker details
            t.id as tasker_id,
            t.name as tasker_name,
            t.surname as tasker_surname,
            COALESCE(tp.profile_photo, '') as tasker_profile_photo,
            tp.description as tasker_description,
            CASE 
              WHEN tr.status IN ('Accepted', 'paid', 'Completed') THEN tr.hourly_rate
              ELSE tp.hourly_rate
            END as tasker_hourly_rate,
            -- Gallery as JSON array with relative paths and forward slashes
            COALESCE(
              (
                SELECT json_agg(
                  CASE 
                    WHEN trg.image_url LIKE 'C:%' OR trg.image_url LIKE '/C:%' 
                    THEN replace(regexp_replace(trg.image_url, '^.*?public[/\\\\]', ''), '\\', '/')
                    ELSE replace(trg.image_url, '\\', '/')
                  END
                )
                FROM task_request_gallery trg
                WHERE trg.task_request_id = tr.id
              ),
              '[]'::json
            ) as gallery
          FROM task_requests tr
          JOIN cities c ON tr.city_id = c.id
          JOIN users s ON tr.sender_id = s.id
          JOIN users t ON tr.tasker_id = t.id
          JOIN tasker_profiles tp ON t.id = tp.user_id
          WHERE tr.tasker_id = $1
          ${status ? 'AND LOWER(tr.status) = $2' : ''}
          ${categoryIds ? `AND EXISTS (
            SELECT 1 FROM task_request_categories trc 
            WHERE trc.task_request_id = tr.id 
            AND trc.category_id = ANY($${status ? 3 : 2}::integer[])
          )` : ''}
          ${cityIds ? `AND c.id = ANY($${status ? categoryIds ? 4 : 3 : categoryIds ? 3 : 2}::integer[])` : ''}
          ${date ? `AND EXISTS (
            SELECT 1 FROM task_request_availability tra 
            WHERE tra.task_request_id = tr.id 
            AND tra.date = $${status ? categoryIds ? cityIds ? 5 : 4 : 4 : categoryIds ? cityIds ? 4 : 3 : cityIds ? 3 : 2}::date
          )` : ''}
          ORDER BY tr.created_at DESC
        `;

        // Build parameters array
        const params = [tasker_id];
        if (status) params.push(status);
        if (categoryIds) params.push(categoryIds);
        if (cityIds) params.push(cityIds);
        if (date) params.push(date);

        console.log('Query parameters:', params);

        const result = await client.query(query, params);
        console.log(`Found ${result.rows.length} task requests for tasker ${tasker_id}`);

        // Format the response
        const taskRequests = result.rows.map((row) => ({
          id: row.id,
          description: row.description,
          city: {
            id: row.city_id,
            name: row.city_name,
          },
          categories: row.categories || [],
          duration: row.duration,
          availability: row.availability || [],
          sender: {
            id: row.sender_id,
            name: row.sender_name,
            surname: row.sender_surname,
            profile_photo: row.sender_profile_photo,
          },
          tasker: {
            id: row.tasker_id,
            name: row.tasker_name,
            surname: row.tasker_surname,
            profile_photo: row.tasker_profile_photo,
            description: row.tasker_description,
            hourly_rate: row.tasker_hourly_rate,
          },
          gallery: row.gallery || [],
          status: row.status,
          created_at: row.created_at,
        }));

        // Debug: Log sample task request if available
        if (taskRequests.length > 0) {
          console.log('Sample task request:', JSON.stringify(taskRequests[0], null, 2));
        } else {
          console.log('No task requests found for this tasker');
        }

        res.json(taskRequests);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting task requests for tasker:', error);
      res.status(500).json({
        error: 'Failed to get task requests',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get specific task request received by tasker
  async getTaskRequestById(req, res) {
    try {
      const tasker_id = req.user.id;
      const task_id = req.params.id;
      console.log('Getting task request ID:', task_id, 'for tasker ID:', tasker_id);

      const client = await pool.connect();
      try {
        // Get task request with related data
        const query = `
          SELECT 
            tr.id,
            tr.description,
            tr.duration,
            tr.status,
            tr.created_at,
            c.id as city_id,
            c.name as city_name,
            -- Sender details
            s.id as sender_id,
            s.name as sender_name,
            s.surname as sender_surname,
            COALESCE(s.profile_photo, '') as sender_profile_photo,
            -- Tasker details
            t.id as tasker_id,
            t.name as tasker_name,
            t.surname as tasker_surname,
            COALESCE(tp.profile_photo, '') as tasker_profile_photo,
            tp.description as tasker_description,
            CASE 
              WHEN tr.status IN ('Accepted', 'paid', 'Completed') THEN tr.hourly_rate
              ELSE tp.hourly_rate
            END as tasker_hourly_rate,
            -- Categories as JSON array
            (
              SELECT json_agg(json_build_object(
                'id', cat.id,
                'name', cat.name,
                'description', cat.description,
                'image_url', cat.image_url
              ))
              FROM task_request_categories trc
              JOIN categories cat ON trc.category_id = cat.id
              WHERE trc.task_request_id = tr.id
            ) as categories,
            -- Availability as JSON array
            (
              SELECT json_agg(json_build_object(
                'date', to_char(tra.date, 'YYYY-MM-DD'),
                'time', to_char(tra.time_slot, 'HH24:MI:SS')
              ))
              FROM task_request_availability tra
              WHERE tra.task_request_id = tr.id
            ) as availability,
            -- Gallery as JSON array
            (
              SELECT json_agg(trg.image_url)
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
            ) as gallery
          FROM task_requests tr
          JOIN cities c ON tr.city_id = c.id
          JOIN users s ON tr.sender_id = s.id
          JOIN users t ON tr.tasker_id = t.id
          JOIN tasker_profiles tp ON t.id = tp.user_id
          WHERE tr.tasker_id = $1 AND tr.id = $2
        `;

        const result = await client.query(query, [tasker_id, task_id]);

        if (result.rows.length === 0) {
          return res.status(404).json({
            error: 'Task request not found or you do not have permission to view it',
          });
        }

        // Format the response
        const row = result.rows[0];
        const taskRequest = {
          id: row.id,
          description: row.description,
          city: {
            id: row.city_id,
            name: row.city_name,
          },
          categories: row.categories || [],
          duration: row.duration,
          availability: row.availability || [],
          sender: {
            id: row.sender_id,
            name: row.sender_name,
            surname: row.sender_surname,
            profile_photo: row.sender_profile_photo,
          },
          tasker: {
            id: row.tasker_id,
            name: row.tasker_name,
            surname: row.tasker_surname,
            profile_photo: row.tasker_profile_photo,
            description: row.tasker_description,
            hourly_rate: row.tasker_hourly_rate,
          },
          gallery: row.gallery || [],
          status: row.status,
          created_at: row.created_at,
        };

        console.log('Found task request:', JSON.stringify(taskRequest, null, 2));
        res.json(taskRequest);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting task request by ID:', error);
      res.status(500).json({
        error: 'Failed to get task request',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Update task request status
  async updateTaskRequestStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get current task status and check if it's from an open task
        const currentStatusQuery = `
          SELECT 
            tr.status, 
            tr.is_open_task, 
            tr.open_task_id, 
            tr.description, 
            tr.city_id, 
            tr.duration,
            tr.sender_id,
            tr.tasker_id,
            tp.hourly_rate as tasker_hourly_rate,
            (SELECT array_agg(trc.category_id) FROM task_request_categories trc WHERE trc.task_request_id = tr.id) as category_ids,
            (SELECT array_agg(trg.image_url) FROM task_request_gallery trg WHERE trg.task_request_id = tr.id) as gallery_images,
            (SELECT array_agg(json_build_object('date', tra.date, 'time', tra.time_slot))
             FROM task_request_availability tra 
             WHERE tra.task_request_id = tr.id) as availability
          FROM task_requests tr
          JOIN users u ON tr.tasker_id = u.id
          JOIN tasker_profiles tp ON u.id = tp.user_id
          WHERE tr.id = $1`;
        const currentStatusResult = await client.query(currentStatusQuery, [id]);

        if (!currentStatusResult.rows.length) {
          return res.status(404).json({ error: 'Task request not found' });
        }

        const taskRequest = currentStatusResult.rows[0];

        // Check if user is either the sender or tasker
        if (taskRequest.sender_id !== req.user.id && taskRequest.tasker_id !== req.user.id) {
          return res.status(403).json({ error: 'Not authorized to update this task request' });
        }

        const currentStatus = taskRequest.status;
        console.log('Current status:', currentStatus, 'New status:', status);

        // Convert 'Accepted' status to 'Waiting for Payment'
        const finalStatus = status === 'Accepted' ? 'Waiting for Payment' : status;

        // Get tasker's name for notifications
        const taskerQuery = `
          SELECT name, surname 
          FROM users 
          WHERE id = $1
        `;
        const taskerResult = await client.query(taskerQuery, [taskRequest.tasker_id]);
        const tasker = taskerResult.rows[0];

        // Handle notifications for specific status changes
        const FirebaseService = require('../services/firebaseService');

        if (finalStatus === 'Waiting for Payment') {
          // Send notification to sender
          await FirebaseService.sendTaskRequestNotification(
            taskRequest.tasker_id,
            taskRequest.sender_id,
            {
              id: id.toString(),
              title: '✅ Užklausa priimta',
              description: `${tasker.name} ${tasker.surname[0]}. priėmė jūsų užklausą. Prašome atlikti mokėjimą.`,
              type: 'waiting_for_payment',
            },
          );
        } else if (finalStatus === 'Declined') {
          // Send notification to sender when task is declined
          await FirebaseService.sendTaskRequestNotification(
            taskRequest.tasker_id,
            taskRequest.sender_id,
            {
              id: id.toString(),
              title: '❌ Užklausa atmestas',
              description: `${tasker.name} ${tasker.surname[0]}. atmetė jūsų užklausą.`,
              type: 'task_declined',
            },
          );
        } else if (finalStatus === 'Completed') {
          // Send notification to sender
          await FirebaseService.sendTaskRequestNotification(
            taskRequest.tasker_id,
            taskRequest.sender_id,
            {
              id: id.toString(),
              title: '✅ Darbas užbaigtas',
              description: `${tasker.name} ${tasker.surname[0]}. pažymėjo jūsų užklausą kaip užbaigtą.`,
              type: 'task_completed',
            },
          );
        } else if (finalStatus === 'Canceled' && currentStatus !== 'paid') {
          // Get the name of who canceled (either tasker or sender)
          const cancelerQuery = `
            SELECT name, surname 
            FROM users 
            WHERE id = $1
          `;
          const cancelerResult = await client.query(cancelerQuery, [req.user.id]);
          const canceler = cancelerResult.rows[0];

          // Send notification to sender if tasker canceled
          if (req.user.id === taskRequest.tasker_id) {
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: id.toString(),
                title: '❌ Užklausa atšaukta',
                description: `${canceler.name} ${canceler.surname[0]}. atšaukė užklausą.`,
                type: 'task_canceled',
              },
            );
          }
        }

        // Handle cancellation of task request that came from open task
        if (finalStatus === 'Canceled by sender' && taskRequest.is_open_task && taskRequest.open_task_id) {
          try {
            // First update task request to remove open task reference
            const updateQuery = `
              UPDATE task_requests 
              SET status = $1::varchar,
                  is_open_task = false,
                  open_task_id = null
              WHERE id = $2 
              RETURNING *
            `;
            const result = await client.query(updateQuery, [finalStatus, id]);

            // Then delete the open task
            await client.query('DELETE FROM open_tasks WHERE id = $1', [taskRequest.open_task_id]);

            // Get sender's name for notification
            const senderQuery = `
              SELECT name, surname 
              FROM users 
              WHERE id = $1
            `;
            const senderResult = await client.query(senderQuery, [req.user.id]);
            const sender = senderResult.rows[0];

            // Send notification to tasker
            const FirebaseService = require('../services/firebaseService');
            await FirebaseService.sendTaskRequestNotification(
              req.user.id,
              taskRequest.tasker_id,
              {
                id: id.toString(),
                title: '❌ Užklausa atšaukta',
                description: `Užklausa buvo atšaukta klientu ${sender.name} ${sender.surname[0]}.`,
                type: 'task_canceled',
              },
            );

            await client.query('COMMIT');
            return res.json(result.rows[0]);
          } catch (error) {
            console.error('Error handling open task cancellation:', error);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to cancel open task' });
          }
        }

        // Handle cancellation of unpaid open task
        if (finalStatus === 'Canceled' && currentStatus !== 'paid' && taskRequest.is_open_task && taskRequest.open_task_id) {
          try {
            // Store the open_task_id before we remove it
            const openTaskId = taskRequest.open_task_id;

            // Update open task status back to 'open'
            const updateOpenTaskQuery = `
              UPDATE open_tasks 
              SET status = 'open'::varchar
              WHERE id = $1
              RETURNING *
            `;
            const openTaskResult = await client.query(updateOpenTaskQuery, [openTaskId]);

            if (!openTaskResult.rows.length) {
              throw new Error('Failed to update open task status');
            }

            // Get sender's name for notification before deleting the task request
            const senderQuery = `
              SELECT name, surname 
              FROM users 
              WHERE id = $1
            `;
            const senderResult = await client.query(senderQuery, [taskRequest.sender_id]);
            const sender = senderResult.rows[0];

            // Get task request gallery photos and convert paths before deleting
            const galleryQuery = `
              SELECT image_url 
              FROM task_request_gallery 
              WHERE task_request_id = $1
            `;
            const galleryResult = await client.query(galleryQuery, [id]);
            const convertedPhotos = galleryResult.rows.map((photo) => {
              // Extract just the filename from the full path
              const filename = photo.image_url.split('\\').pop().split('/').pop();
              return `images/tasks/${filename}`;
            });

            // If there are photos, insert them with correct path format
            if (convertedPhotos.length > 0) {
              for (const photoUrl of convertedPhotos) {
                await client.query(
                  `INSERT INTO open_task_photos (task_id, photo_url)
                   VALUES ($1, $2)`,
                  [openTaskResult.rows[0].id, photoUrl],
                );
              }
            }

            // Delete the task request and all related data
            await client.query('DELETE FROM task_request_gallery WHERE task_request_id = $1', [id]);
            await client.query('DELETE FROM task_request_categories WHERE task_request_id = $1', [id]);
            await client.query('DELETE FROM task_request_availability WHERE task_request_id = $1', [id]);
            await client.query('DELETE FROM task_requests WHERE id = $1', [id]);

            // Send notification to tasker
            const FirebaseService = require('../services/firebaseService');
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.sender_id,
              taskRequest.tasker_id,
              {
                id: id.toString(),
                title: '❌ Užklausa atšaukta',
                description: `${sender.name} ${sender.surname[0]}. užklausa buvo atšauktas.`,
                type: 'task_canceled',
              },
            );

            // Send notification to sender about cancellation
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: id.toString(),
                title: '❌ Užklausa atšaukta',
                description: `Jūsų užklausa su ${tasker.name} ${tasker.surname[0]}. buvo atšaukta.`,
                type: 'task_canceled',
              },
            );

            // Send notification to sender about task being open
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: openTaskResult.rows[0].id.toString(),
                title: '📋 Atvira užklausa',
                description: 'Užklausa dabar prieinama visiems paslaugų teikėjams.',
                type: 'task_open',
              },
            );

            await client.query('COMMIT');
            return res.json({
              message: 'Task request canceled and deleted',
              open_task: openTaskResult.rows[0],
            });
          } catch (error) {
            console.error('Error handling open task cancellation:', error);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to cancel open task' });
          }
        }

        // Special handling for canceling a paid open task
        if (finalStatus === 'Canceled' && currentStatus === 'paid' && taskRequest.is_open_task && taskRequest.open_task_id) {
          try {
            // Store the open_task_id before we remove it
            const openTaskId = taskRequest.open_task_id;

            // Process the refund
            const refundResult = await Payment.handleTaskCancellation(id);
            console.log('Payment refund result:', refundResult);

            // Update open task status back to 'open' FIRST
            const updateOpenTaskQuery = `
              UPDATE open_tasks 
              SET status = 'open'::varchar
              WHERE id = $1
              RETURNING *
            `;
            const openTaskResult = await client.query(updateOpenTaskQuery, [openTaskId]);

            if (!openTaskResult.rows.length) {
              throw new Error('Failed to update open task status');
            }

            // Then update task request
            const updateTaskRequestQuery = `
              UPDATE task_requests 
              SET status = 'refunded'::varchar,
                  is_open_task = false,
                  open_task_id = null
              WHERE id = $1
              RETURNING *
            `;
            const taskRequestResult = await client.query(updateTaskRequestQuery, [id]);

            // Get sender's name for notification
            const senderQuery = `
              SELECT name, surname 
              FROM users 
              WHERE id = $1
            `;
            const senderResult = await client.query(senderQuery, [taskRequest.sender_id]);
            const sender = senderResult.rows[0];

            // Send notification to tasker
            const FirebaseService = require('../services/firebaseService');
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.sender_id,
              taskRequest.tasker_id,
              {
                id: id.toString(),
                title: '❌ Suplanuotas darbas atšauktas',
                description: `Suplanuotas darbas pas ${sender.name} ${sender.surname[0]}. buvo atšauktas.`,
                type: 'task_canceled',
              },
            );

            // Send notification to sender
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: id.toString(),
                title: '❌ Suplanuotas darbas atšauktas',
                description: `Jūsų suplanuotas darbas su ${tasker.name} ${tasker.surname[0]}. buvo atšauktas.`,
                type: 'task_canceled',
              },
            );

            // Send payment refund notification to sender
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: id.toString(),
                title: '💰 Mokėjimas grąžintas',
                description: 'Mokėjimas už atšauktą užsakymą buvo grąžintas į jūsų skaitmeninę piniginę.',
                type: 'payment_refunded',
              },
            );

            // Send notification to sender about task being open
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: openTaskResult.rows[0].id.toString(),
                title: '📋 Atvira užklausa',
                description: 'Užklausa dabar prieinama visiems paslaugų teikėjams.',
                type: 'task_open',
              },
            );

            await client.query('COMMIT');
            return res.json({
              message: 'Task request canceled and refunded',
              task_request: taskRequestResult.rows[0],
              open_task: openTaskResult.rows[0],
            });
          } catch (error) {
            console.error('Error handling payment refund:', error);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to process payment refund' });
          }
        }

        // If task is being canceled and was previously paid, handle payment refund
        if (finalStatus === 'Canceled' && currentStatus === 'paid' && !taskRequest.is_open_task) {
          try {
            const refundResult = await Payment.handleTaskCancellation(id);
            console.log('Payment refund result:', refundResult);

            // Update task request to refunded status
            const updateQuery = `
              UPDATE task_requests 
              SET status = 'refunded'::varchar
              WHERE id = $1
              RETURNING *
            `;
            const result = await client.query(updateQuery, [id]);

            // Get sender's name for notification
            const senderQuery = `
              SELECT name, surname 
              FROM users 
              WHERE id = $1
            `;
            const senderResult = await client.query(senderQuery, [req.user.id]);
            const sender = senderResult.rows[0];

            // Send notification to tasker
            const FirebaseService = require('../services/firebaseService');
            await FirebaseService.sendTaskRequestNotification(
              req.user.id,
              taskRequest.tasker_id,
              {
                id: id.toString(),
                title: '❌ Suplanuotas darbas atšauktas',
                description: `Suplanuotas darbas pas ${sender.name} ${sender.surname[0]}. buvo atšauktas.`,
                type: 'task_canceled',
              },
            );

            // Send notification to sender
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: id.toString(),
                title: '❌ Suplanuotas darbas atšauktas',
                description: `Jūsų suplanuotas darbas su ${tasker.name} ${tasker.surname[0]}. buvo atšauktas.`,
                type: 'task_canceled',
              },
            );

            // Send payment refund notification to sender
            await FirebaseService.sendTaskRequestNotification(
              taskRequest.tasker_id,
              taskRequest.sender_id,
              {
                id: id.toString(),
                title: '💰 Mokėjimas grąžintas',
                description: 'Mokėjimas už atšauktą darbą buvo grąžintas į jūsų skaitmeninę piniginę.',
                type: 'payment_refunded',
              },
            );

            await client.query('COMMIT');
            return res.json(result.rows[0]);
          } catch (error) {
            console.error('Error handling payment refund:', error);
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to process payment refund' });
          }
        }

        // Regular status update for non-open tasks or non-cancel operations
        const updateQuery = `
          UPDATE task_requests 
          SET status = $1::varchar,
              hourly_rate = CASE 
                WHEN $1::varchar = 'Waiting for Payment' AND status = 'pending' 
                THEN $2
                ELSE hourly_rate
              END
          WHERE id = $3 
          RETURNING *
        `;
        const result = await client.query(updateQuery, [
          finalStatus,
          taskRequest.tasker_hourly_rate,
          id,
        ]);

        // If status is "Canceled by sender", send notification to tasker
        if (finalStatus === 'Canceled by sender') {
          // Get sender's name
          const senderQuery = `
            SELECT name, surname 
            FROM users 
            WHERE id = $1
          `;
          const senderResult = await client.query(senderQuery, [req.user.id]);
          const sender = senderResult.rows[0];

          // Send notification to tasker
          const FirebaseService = require('../services/firebaseService');
          await FirebaseService.sendTaskRequestNotification(
            req.user.id,
            taskRequest.tasker_id,
            {
              id: id.toString(),
              title: '❌ Užklausa atšaukta',
              description: `Užklausa atšaukta klientu ${sender.name} ${sender.surname[0]}.`,
              type: 'task_canceled',
            },
          );
        }

        // If task is marked as completed, handle payment completion
        if (finalStatus.toLowerCase() === 'completed') {
          try {
            // Get the payment record
            const payment = await Payment.getByTaskRequestId(id);
            if (!payment) {
              throw new Error('Payment record not found');
            }

            // Update payment status to completed
            await Payment.updateStatusToCompleted(id);
          } catch (error) {
            console.error('Error handling payment completion:', error);
            throw error;
          }
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in transaction:', error);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating task request status:', error);
      res.status(500).json({ error: 'Failed to update task request status' });
    }
  },

  // Get specific task by ID for sender
  async getTaskById(req, res) {
    try {
      const sender_id = req.user.id;
      const task_id = req.params.id;
      console.log('Getting task ID:', task_id, 'for sender ID:', sender_id);

      const client = await pool.connect();
      try {
        // First try to get task from task_requests
        const taskRequestQuery = `
          SELECT 
            'task_request' as task_type,
            tr.id,
            tr.description,
            tr.duration,
            tr.status,
            tr.created_at,
            tr.is_open_task,
            tr.open_task_id,
            NULL::decimal as budget,
            c.id as city_id,
            c.name as city_name,
            -- Categories as JSON array
            (
              SELECT json_agg(json_build_object(
                'id', cat.id,
                'name', cat.name,
                'description', cat.description,
                'image_url', cat.image_url
              ))
              FROM task_request_categories trc
              JOIN categories cat ON trc.category_id = cat.id
              WHERE trc.task_request_id = tr.id
            ) as categories,
            -- Availability as JSON array
            (
              SELECT json_agg(json_build_object(
                'date', to_char(tra.date, 'YYYY-MM-DD'),
                'time', to_char(tra.time_slot, 'HH24:MI:SS')
              ))
              FROM task_request_availability tra
              WHERE tra.task_request_id = tr.id
            ) as availability,
            -- Sender details
            s.id as sender_id,
            s.name as sender_name,
            s.surname as sender_surname,
            COALESCE(s.profile_photo, '') as sender_profile_photo,
            -- Tasker details
            t.id as tasker_id,
            t.name as tasker_name,
            t.surname as tasker_surname,
            COALESCE(tp.profile_photo, '') as tasker_profile_photo,
            tp.description as tasker_description,
            tr.hourly_rate as tasker_hourly_rate,
            -- Gallery as JSON array with relative paths and forward slashes
            COALESCE(
            (
                SELECT json_agg(
                  CASE 
                    WHEN trg.image_url LIKE 'C:%' OR trg.image_url LIKE '/C:%' 
                    THEN replace(regexp_replace(trg.image_url, '^.*?public[/\\\\]', ''), '\\', '/')
                    ELSE replace(trg.image_url, '\\', '/')
                  END
                )
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
              ),
              '[]'::json
            ) as gallery
          FROM task_requests tr
          JOIN cities c ON tr.city_id = c.id
          JOIN users s ON tr.sender_id = s.id
          JOIN users t ON tr.tasker_id = t.id
          JOIN tasker_profiles tp ON t.id = tp.user_id
          WHERE tr.sender_id = $1 AND tr.id = $2
        `;

        const taskRequestResult = await client.query(taskRequestQuery, [sender_id, task_id]);

        // If not found in task_requests, try open_tasks
        if (taskRequestResult.rows.length === 0) {
          const openTaskQuery = `
            SELECT 
              'open_task' as task_type,
              ot.id,
              ot.description,
              ot.duration,
              ot.status,
              ot.created_at,
              ot.budget,
              c.id as city_id,
              c.name as city_name,
              -- Categories
              json_build_array(
                json_build_object(
                  'id', cat.id,
                  'name', cat.name,
                  'description', cat.description,
                  'image_url', cat.image_url
                )
              ) as categories,
              -- Availability
              (
                SELECT json_agg(json_build_object(
                  'date', to_char(otd.date, 'YYYY-MM-DD'),
                  'time', to_char(otd.time, 'HH24:MI:SS')
                ))
                FROM open_task_dates otd
                WHERE otd.task_id = ot.id
              ) as availability,
              -- Sender (creator) details
              s.id as sender_id,
              s.name as sender_name,
              s.surname as sender_surname,
              COALESCE(s.profile_photo, '') as sender_profile_photo,
              -- Gallery with relative paths and forward slashes
              COALESCE(
                (
                  SELECT json_agg(
                    CASE 
                      WHEN otp.photo_url LIKE 'C:%' OR otp.photo_url LIKE '/C:%' 
                      THEN replace(regexp_replace(otp.photo_url, '^.*?public[/\\\\]', ''), '\\', '/')
                      ELSE replace(otp.photo_url, '\\', '/')
                    END
                  )
                  FROM open_task_photos otp
                  WHERE otp.task_id = ot.id
                ),
                '[]'::json
              ) as gallery
            FROM open_tasks ot
            JOIN cities c ON ot.location_id = c.id
            JOIN categories cat ON ot.category_id = cat.id
            JOIN users s ON ot.creator_id = s.id
            WHERE ot.creator_id = $1 AND ot.id = $2
          `;

          const openTaskResult = await client.query(openTaskQuery, [sender_id, task_id]);

          if (openTaskResult.rows.length === 0) {
            return res.status(404).json({
              error: 'Task not found or you do not have permission to view it',
            });
          }

          // Format open task response
          const row = openTaskResult.rows[0];
          const task = {
            task_type: row.task_type,
            id: row.id,
            description: row.description,
            city: {
              id: row.city_id,
              name: row.city_name,
            },
            categories: row.categories || [],
            duration: row.duration,
            availability: row.availability || [],
            sender: {
              id: row.sender_id,
              name: row.sender_name,
              surname: row.sender_surname,
              profile_photo: row.sender_profile_photo,
            },
            tasker: null,
            gallery: row.gallery || [],
            status: row.status,
            created_at: row.created_at,
            budget: row.budget,
          };

          console.log('Found open task:', JSON.stringify(task, null, 2));
          return res.json(task);
        }

        // Format task request response
        const row = taskRequestResult.rows[0];
        const task = {
          task_type: row.task_type,
          id: row.id,
          description: row.description,
          city: {
            id: row.city_id,
            name: row.city_name,
          },
          categories: row.categories || [],
          duration: row.duration,
          availability: row.availability || [],
          sender: {
            id: row.sender_id,
            name: row.sender_name,
            surname: row.sender_surname,
            profile_photo: row.sender_profile_photo,
          },
          tasker: row.tasker_id ? {
            id: row.tasker_id,
            name: row.tasker_name,
            surname: row.tasker_surname,
            profile_photo: row.tasker_profile_photo,
            description: row.tasker_description,
            hourly_rate: row.tasker_hourly_rate,
          } : null,
          gallery: row.gallery || [],
          status: row.status,
          created_at: row.created_at,
          budget: row.budget,
          is_open_task: row.is_open_task,
          open_task_id: row.open_task_id,
        };

        console.log('Found task request:', JSON.stringify(task, null, 2));
        res.json(task);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error getting task by ID:', error);
      res.status(500).json({
        error: 'Failed to get task',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Test endpoint to insert sample data
  async insertTestData(req, res) {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert a test task
        const taskResult = await client.query(`
          INSERT INTO task_requests (
            description, 
            city_id, 
            duration, 
            sender_id, 
            tasker_id, 
            status
          ) VALUES ($1, $2, $3, $4, $5, $6) 
          RETURNING id
        `, ['Test cleaning task', 1, '2 hours', 8, 1, 'pending']);

        const taskId = taskResult.rows[0].id;

        // Insert test category
        await client.query(`
          INSERT INTO task_request_categories (task_request_id, category_id)
          VALUES ($1, $2)
        `, [taskId, 1]);

        // Insert test availability
        await client.query(`
          INSERT INTO task_request_availability (task_request_id, date, time_slot)
          VALUES ($1, $2, $3)
        `, [taskId, '2024-03-20', '09:00:00']);

        await client.query('COMMIT');
        res.json({ message: 'Test data inserted successfully', taskId });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error inserting test data:', error);
      res.status(500).json({
        error: 'Failed to insert test data',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get paid tasks that were sent by the user
  async getPaidTasksSent(req, res) {
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      const query = `
        SELECT 
          tr.id,
          tr.description,
          tr.duration,
          tr.status,
          tr.created_at,
          -- City details
          c.id as city_id,
          c.name as city_name,
          -- Categories as JSON array
          (
            SELECT json_agg(json_build_object(
              'id', cat.id,
              'name', cat.name,
              'description', cat.description,
              'image_url', cat.image_url
            ))
            FROM task_request_categories trc
            JOIN categories cat ON trc.category_id = cat.id
            WHERE trc.task_request_id = tr.id
          ) as categories,
          -- Sender details
          s.id as sender_id,
          s.name as sender_name,
          s.surname as sender_surname,
          COALESCE(s.profile_photo, '') as sender_profile_photo,
          -- Tasker details
          t.id as tasker_id,
          t.name as tasker_name,
          t.surname as tasker_surname,
          COALESCE(tp.profile_photo, '') as tasker_profile_photo,
          tp.description as tasker_description,
          tp.hourly_rate as tasker_hourly_rate,
          -- Availability as JSON array
          (
            SELECT json_agg(json_build_object(
              'date', to_char(tra.date, 'YYYY-MM-DD'),
              'time', to_char(tra.time_slot, 'HH24:MI:SS')
            ))
            FROM task_request_availability tra
            WHERE tra.task_request_id = tr.id
          ) as availability,
          -- Gallery as JSON array
          COALESCE(
            (
              SELECT json_agg(trg.image_url)
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
            ),
            '[]'::json
          ) as gallery
        FROM task_requests tr
        JOIN cities c ON tr.city_id = c.id
        JOIN users s ON tr.sender_id = s.id
        JOIN users t ON tr.tasker_id = t.id
        JOIN tasker_profiles tp ON t.id = tp.user_id
        WHERE tr.sender_id = $1 
        AND tr.status = 'paid'
        ORDER BY tr.created_at DESC
      `;

      const result = await client.query(query, [userId]);

      const paidTasks = result.rows.map((row) => ({
        id: row.id,
        description: row.description,
        city: {
          id: row.city_id,
          name: row.city_name,
        },
        categories: row.categories || [],
        duration: row.duration,
        availability: row.availability || [],
        sender: {
          id: row.sender_id,
          name: row.sender_name,
          surname: row.sender_surname,
          profile_photo: row.sender_profile_photo,
        },
        tasker: {
          id: row.tasker_id,
          name: row.tasker_name,
          surname: row.tasker_surname,
          profile_photo: row.tasker_profile_photo,
          description: row.tasker_description,
          hourly_rate: row.tasker_hourly_rate,
        },
        gallery: row.gallery || [],
        status: row.status,
        created_at: row.created_at,
      }));

      res.json(paidTasks);
    } catch (error) {
      console.error('Error getting paid tasks sent:', error);
      res.status(500).json({ error: 'Failed to get paid tasks' });
    } finally {
      client.release();
    }
  },

  // Get paid tasks that were received by the tasker
  async getPaidTasksReceived(req, res) {
    const taskerId = req.user.id;
    const client = await pool.connect();

    try {
      const query = `
        SELECT 
          tr.id,
          tr.description,
          tr.duration,
          tr.status,
          tr.created_at,
          -- City details
          c.id as city_id,
          c.name as city_name,
          -- Categories as JSON array
          (
            SELECT json_agg(json_build_object(
              'id', cat.id,
              'name', cat.name,
              'description', cat.description,
              'image_url', cat.image_url
            ))
            FROM task_request_categories trc
            JOIN categories cat ON trc.category_id = cat.id
            WHERE trc.task_request_id = tr.id
          ) as categories,
          -- Sender details
          s.id as sender_id,
          s.name as sender_name,
          s.surname as sender_surname,
          COALESCE(s.profile_photo, '') as sender_profile_photo,
          -- Tasker details
          t.id as tasker_id,
          t.name as tasker_name,
          t.surname as tasker_surname,
          COALESCE(tp.profile_photo, '') as tasker_profile_photo,
          tp.description as tasker_description,
          tp.hourly_rate as tasker_hourly_rate,
          -- Availability as JSON array
          (
            SELECT json_agg(json_build_object(
              'date', to_char(tra.date, 'YYYY-MM-DD'),
              'time', to_char(tra.time_slot, 'HH24:MI:SS')
            ))
            FROM task_request_availability tra
            WHERE tra.task_request_id = tr.id
          ) as availability,
          -- Gallery as JSON array
          COALESCE(
            (
              SELECT json_agg(trg.image_url)
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
            ),
            '[]'::json
          ) as gallery
        FROM task_requests tr
        JOIN cities c ON tr.city_id = c.id
        JOIN users s ON tr.sender_id = s.id
        JOIN users t ON tr.tasker_id = t.id
        JOIN tasker_profiles tp ON t.id = tp.user_id
        WHERE tr.tasker_id = $1 
        AND tr.status = 'paid'
        ORDER BY tr.created_at DESC
      `;

      const result = await client.query(query, [taskerId]);

      const paidTasks = result.rows.map((row) => ({
        id: row.id,
        description: row.description,
        city: {
          id: row.city_id,
          name: row.city_name,
        },
        categories: row.categories || [],
        duration: row.duration,
        availability: row.availability || [],
        sender: {
          id: row.sender_id,
          name: row.sender_name,
          surname: row.sender_surname,
          profile_photo: row.sender_profile_photo,
        },
        tasker: {
          id: row.tasker_id,
          name: row.tasker_name,
          surname: row.tasker_surname,
          profile_photo: row.tasker_profile_photo,
          description: row.tasker_description,
          hourly_rate: row.tasker_hourly_rate,
        },
        gallery: row.gallery || [],
        status: row.status,
        created_at: row.created_at,
      }));

      res.json(paidTasks);
    } catch (error) {
      console.error('Error getting paid tasks received:', error);
      res.status(500).json({ error: 'Failed to get paid tasks' });
    } finally {
      client.release();
    }
  },

  // Get completed tasks sent by tasker
  async getSentCompletedTasks(req, res) {
    try {
      const query = `
        SELECT 
          tr.id,
          tr.description,
          tr.duration,
          tr.status,
          tr.created_at,
          -- City details
          c.id as city_id,
          c.name as city_name,
          -- Categories as JSON array
          (
            SELECT json_agg(json_build_object(
              'id', cat.id,
              'name', cat.name,
              'description', cat.description,
              'image_url', cat.image_url
            ))
            FROM task_request_categories trc
            JOIN categories cat ON trc.category_id = cat.id
            WHERE trc.task_request_id = tr.id
          ) as categories,
          -- Availability as JSON array
          (
            SELECT json_agg(json_build_object(
              'date', to_char(tra.date, 'YYYY-MM-DD'),
              'time', to_char(tra.time_slot, 'HH24:MI:SS')
            ))
            FROM task_request_availability tra
            WHERE tra.task_request_id = tr.id
          ) as availability,
          -- Sender details
          s.id as sender_id,
          s.name as sender_name,
          s.surname as sender_surname,
          COALESCE(s.profile_photo, '') as sender_profile_photo,
          -- Tasker details
          t.id as tasker_id,
          t.name as tasker_name,
          t.surname as tasker_surname,
          COALESCE(tp.profile_photo, '') as tasker_profile_photo,
          tp.description as tasker_description,
          tp.hourly_rate as tasker_hourly_rate,
          -- Gallery as JSON array
          COALESCE(
            (
              SELECT json_agg(trg.image_url)
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
            ),
            '[]'::json
          ) as gallery
        FROM task_requests tr
        JOIN cities c ON tr.city_id = c.id
        JOIN users s ON tr.sender_id = s.id
        JOIN users t ON tr.tasker_id = t.id
        JOIN tasker_profiles tp ON t.id = tp.user_id
        WHERE tr.sender_id = $1 
        AND tr.status = 'Completed'
        ORDER BY tr.created_at DESC
      `;

      const result = await pool.query(query, [req.user.id]);

      const tasks = result.rows.map((row) => ({
        id: row.id,
        description: row.description,
        city: {
          id: row.city_id,
          name: row.city_name,
        },
        categories: row.categories || [],
        duration: row.duration,
        availability: row.availability || [],
        sender: {
          id: row.sender_id,
          name: row.sender_name,
          surname: row.sender_surname,
          profile_photo: row.sender_profile_photo,
        },
        tasker: {
          id: row.tasker_id,
          name: row.tasker_name,
          surname: row.tasker_surname,
          profile_photo: row.tasker_profile_photo,
          description: row.tasker_description,
          hourly_rate: row.tasker_hourly_rate,
        },
        gallery: row.gallery || [],
        status: row.status,
        created_at: row.created_at,
      }));

      res.json(tasks);
    } catch (error) {
      console.error('Error getting completed tasks sent:', error);
      res.status(500).json({ error: 'Failed to get completed tasks' });
    }
  },

  // Get completed tasks received by tasker
  async getReceivedCompletedTasks(req, res) {
    try {
      const query = `
        SELECT 
          tr.id,
          tr.description,
          tr.duration,
          tr.status,
          tr.created_at,
          -- City details
          c.id as city_id,
          c.name as city_name,
          -- Categories as JSON array
          (
            SELECT json_agg(json_build_object(
              'id', cat.id,
              'name', cat.name,
              'description', cat.description,
              'image_url', cat.image_url
            ))
            FROM task_request_categories trc
            JOIN categories cat ON trc.category_id = cat.id
            WHERE trc.task_request_id = tr.id
          ) as categories,
          -- Availability as JSON array
          (
            SELECT json_agg(json_build_object(
              'date', to_char(tra.date, 'YYYY-MM-DD'),
              'time', to_char(tra.time_slot, 'HH24:MI:SS')
            ))
            FROM task_request_availability tra
            WHERE tra.task_request_id = tr.id
          ) as availability,
          -- Sender details
          s.id as sender_id,
          s.name as sender_name,
          s.surname as sender_surname,
          COALESCE(s.profile_photo, '') as sender_profile_photo,
          -- Tasker details
          t.id as tasker_id,
          t.name as tasker_name,
          t.surname as tasker_surname,
          COALESCE(tp.profile_photo, '') as tasker_profile_photo,
          tp.description as tasker_description,
          tp.hourly_rate as tasker_hourly_rate,
          -- Gallery as JSON array
          COALESCE(
            (
              SELECT json_agg(trg.image_url)
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
            ),
            '[]'::json
          ) as gallery
        FROM task_requests tr
        JOIN cities c ON tr.city_id = c.id
        JOIN users s ON tr.sender_id = s.id
        JOIN users t ON tr.tasker_id = t.id
        JOIN tasker_profiles tp ON t.id = tp.user_id
        WHERE tr.tasker_id = $1 
        AND tr.status = 'Completed'
        ORDER BY tr.created_at DESC
      `;

      const result = await pool.query(query, [req.user.id]);

      const tasks = result.rows.map((row) => ({
        id: row.id,
        description: row.description,
        city: {
          id: row.city_id,
          name: row.city_name,
        },
        categories: row.categories || [],
        duration: row.duration,
        availability: row.availability || [],
        sender: {
          id: row.sender_id,
          name: row.sender_name,
          surname: row.sender_surname,
          profile_photo: row.sender_profile_photo,
        },
        tasker: {
          id: row.tasker_id,
          name: row.tasker_name,
          surname: row.tasker_surname,
          profile_photo: row.tasker_profile_photo,
          description: row.tasker_description,
          hourly_rate: row.tasker_hourly_rate,
        },
        gallery: row.gallery || [],
        status: row.status,
        created_at: row.created_at,
      }));

      res.json(tasks);
    } catch (error) {
      console.error('Error getting completed tasks received:', error);
      res.status(500).json({ error: 'Failed to get completed tasks' });
    }
  },

  // Get wallet amount and payment history
  async getWalletPayments(req, res) {
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      // First get the user's wallet amount and IBAN
      const userQuery = `
        SELECT wallet_amount, wallet_bank_iban
        FROM users 
        WHERE id = $1
      `;
      const userResult = await client.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get all transactions (both earnings and payments)
      const transactionsQuery = `
        SELECT 
          p.id as payment_id,
          p.amount,
          p.created_at as payment_date,
          p.status as payment_status,
          p.is_payment,
          tr.id as task_id,
          tr.status as task_status,
          CASE 
            WHEN p.is_payment = true THEN t.name
            ELSE s.name
          END as other_party_name,
          CASE 
            WHEN p.is_payment = true THEN t.surname
            ELSE s.surname
          END as other_party_surname,
          CASE 
            WHEN p.is_payment = true THEN 'tasker'
            ELSE 'sender'
          END as other_party_role,
          (
            SELECT string_agg(cat.name, ', ')
            FROM task_request_categories trc
            JOIN categories cat ON trc.category_id = cat.id
            WHERE trc.task_request_id = tr.id
          ) as categories
        FROM payments p
        JOIN task_requests tr ON p.task_request_id = tr.id
        JOIN users s ON tr.sender_id = s.id
        JOIN users t ON tr.tasker_id = t.id
        WHERE p.user_id = $1
        AND p.status IN ('completed', 'on hold', 'refunded')
        ORDER BY p.created_at DESC
      `;

      const transactionsResult = await client.query(transactionsQuery, [userId]);

      // Format the response
      const response = {
        wallet_amount: userResult.rows[0].wallet_amount || 0,
        wallet_bank_iban: userResult.rows[0].wallet_bank_iban || null,
        transactions: transactionsResult.rows.map((row) => ({
          payment_id: row.payment_id,
          amount: row.payment_status === 'refunded'
            ? Math.abs(row.amount) // Make refunded amount positive before negating
            : (row.is_payment ? row.amount * -1 : row.amount), // Normal payment logic
          payment_date: row.payment_date,
          payment_status: row.payment_status,
          transaction_type: row.payment_status === 'refunded' ? 'refund' : (row.is_payment ? 'payment' : 'earning'),
          task: {
            id: row.task_id,
            category: row.categories || '',
            status: row.task_status,
          },
          other_party: {
            role: row.other_party_role,
            name: row.other_party_name,
            surname: row.other_party_surname,
          },
        })),
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting wallet transactions:', error);
      res.status(500).json({
        error: 'Failed to get wallet transactions',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      client.release();
    }
  },

  // Check if user is a tasker
  async checkIfTasker(req, res) {
    try {
      const userId = req.user.id;

      const query = `
        SELECT is_tasker 
        FROM users 
        WHERE id = $1
      `;

      const result = await pool.query(query, [userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        is_tasker: result.rows[0].is_tasker,
      });
    } catch (error) {
      console.error('Error checking if user is tasker:', error);
      res.status(500).json({
        error: 'Failed to check tasker status',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Convert task request to open task
  async convertToOpenTask(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.id;
      const task_id = req.params.id;
      const { budget, availability } = req.body; // Get budget and availability from request body

      if (!budget || !availability || !Array.isArray(availability) || availability.length === 0) {
        return res.status(400).json({
          error: 'Budget and availability array are required',
        });
      }

      console.log('Converting task request to open task:', {
        taskId: task_id,
        userId: user_id,
        budget,
        availability,
      });

      await client.query('BEGIN');

      // First get the task request details
      const taskRequestQuery = `
        SELECT 
          tr.*,
          array_agg(DISTINCT trc.category_id) as category_ids,
          array_agg(DISTINCT trg.image_url) as gallery_images
        FROM task_requests tr
        LEFT JOIN task_request_categories trc ON tr.id = trc.task_request_id
        LEFT JOIN task_request_gallery trg ON tr.id = trg.task_request_id
        WHERE tr.id = $1 AND tr.sender_id = $2
        GROUP BY tr.id
      `;

      const taskRequestResult = await client.query(taskRequestQuery, [task_id, user_id]);

      if (taskRequestResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Task request not found or you do not have permission to modify it',
        });
      }

      const taskRequest = taskRequestResult.rows[0];
      console.log('Task request details:', taskRequest);

      // Create new open task
      const createOpenTaskQuery = `
        INSERT INTO open_tasks (
          description,
          budget,
          duration,
          location_id,
          creator_id,
          category_id,
          status,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `;

      const categoryId = taskRequest.category_ids[0];

      // Create the open task with the provided budget
      const openTaskResult = await client.query(createOpenTaskQuery, [
        taskRequest.description,
        budget, // Use the budget from request body
        taskRequest.duration,
        taskRequest.city_id,
        user_id,
        categoryId,
        'open',
      ]);

      const openTask = openTaskResult.rows[0];
      console.log('Created open task:', openTask);

      // Clear any existing availability slots (just in case)
      await client.query('DELETE FROM open_task_dates WHERE task_id = $1', [openTask.id]);

      // Add new availability slots
      for (const slot of availability) {
        await client.query(
          `INSERT INTO open_task_dates (task_id, date, time)
           VALUES ($1, $2, $3)`,
          [openTask.id, slot.date, slot.time],
        );
      }
      console.log('Added availability slots:', availability);

      // Copy gallery images
      if (taskRequest.gallery_images && taskRequest.gallery_images.length > 0) {
        for (const imageUrl of taskRequest.gallery_images) {
          if (imageUrl) {
            // Extract just the filename from the full path
            const filename = imageUrl.split('\\').pop().split('/').pop();
            const formattedPath = `images/tasks/${filename}`;

            await client.query(
              `INSERT INTO open_task_photos (task_id, photo_url)
               VALUES ($1, $2)`,
              [openTask.id, formattedPath],
            );
          }
        }
      }

      // Delete the original task request
      await client.query('DELETE FROM task_requests WHERE id = $1', [task_id]);

      // Get the complete open task with all details
      const completeTaskQuery = `
        SELECT 
          ot.*,
          jsonb_build_object(
            'id', c.id,
            'name', c.name
          ) as city,
          jsonb_build_object(
            'id', cat.id,
            'name', cat.name,
            'description', cat.description,
            'image_url', cat.image_url
          ) as category,
          jsonb_build_object(
            'id', u.id,
            'name', u.name,
            'surname', u.surname,
            'profile_photo', u.profile_photo
          ) as creator,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'date', to_char(otd.date, 'YYYY-MM-DD'),
                'time', to_char(otd.time, 'HH24:MI:SS')
              )
            ) FILTER (WHERE otd.date IS NOT NULL),
            '[]'
          ) as availability,
          COALESCE(
            json_agg(
              DISTINCT regexp_replace(
                otp.photo_url,
                '^.*\\\\public\\\\|^.*public/',
                ''
              )
            ) FILTER (WHERE otp.photo_url IS NOT NULL),
            '[]'
          ) as gallery
        FROM open_tasks ot
        JOIN cities c ON ot.location_id = c.id
        JOIN categories cat ON ot.category_id = cat.id
        JOIN users u ON ot.creator_id = u.id
        LEFT JOIN open_task_dates otd ON ot.id = otd.task_id
        LEFT JOIN open_task_photos otp ON ot.id = otp.task_id
        WHERE ot.id = $1
        GROUP BY ot.id, c.id, c.name, cat.id, cat.name, cat.description, cat.image_url,
                 u.id, u.name, u.surname, u.profile_photo
      `;

      const completeTask = await client.query(completeTaskQuery, [openTask.id]);

      await client.query('COMMIT');

      res.json({
        message: 'Successfully converted task request to open task',
        task: completeTask.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error converting task request to open task:', error);
      res.status(500).json({
        error: 'Failed to convert task request to open task',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      client.release();
    }
  },
};

module.exports = {
  ...taskerController,
  uploadFields,
};
