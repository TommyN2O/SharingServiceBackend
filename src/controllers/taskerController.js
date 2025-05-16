const path = require('path');
const multer = require('multer');
const fs = require('fs');
const TaskerProfile = require('../models/TaskerProfile');
const CustomerRequest = require('../models/CustomerRequest');
const PlannedTask = require('../models/PlannedTask');
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
      const tasks = await CustomerRequest.findAvailable({
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

      const offer = await CustomerRequest.createOffer({
        request_id: requestId,
        tasker_id: req.user.id,
        price,
        estimated_time,
        message,
      });

      // Send notification to customer
      const request = await CustomerRequest.findById(requestId);
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

      const task = await PlannedTask.acceptTask(taskId, req.user.id);

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
        type: 'notification',
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
      console.log('Getting all tasker profiles with filters:', req.query);
      const filters = {
        category: req.query.category ? parseInt(req.query.category) : null,
        rating: req.query.rating ? req.query.rating : null,
        city: req.query.city ? req.query.city : null,
        date: req.query.date ? req.query.date : null,
        timeFrom: req.query.timeFrom ? req.query.timeFrom : null,
        timeTo: req.query.timeTo ? req.query.timeTo : null,
        minPrice: req.query.minPrice ? parseFloat(req.query.minPrice) : null,
        maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice) : null,
      };
      const profiles = await TaskerProfile.getAllProfiles(filters);
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
            error: 'Date must be in YYYY-MM-DD format',
            invalidDate: slot.date,
          });
        }

        // Validate time format (HH:mm:ss)
        if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(slot.time)) {
          return res.status(400).json({
            error: 'Time must be in HH:mm:ss format',
            invalidTime: slot.time,
          });
        }
      }

      // Use the TaskerProfile update method
      const _updatedProfile = await TaskerProfile.update(req.user.id, {
        availability,
      });

      res.status(200).json(_updatedProfile);
    } catch (error) {
      console.error('Error updating tasker availability:', error);
      res.status(500).json({
        error: 'Failed to update availability',
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
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
        RETURNING id, created_at
      `;

      const taskRequestResult = await client.query(taskRequestQuery, [
        description,
        city.id,
        duration,
        sender_id,
        taskerUserId, // Use the user_id we got from tasker_profiles
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
            CASE 
              WHEN tr.status = 'Waiting for Payment' THEN tr.hourly_rate
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
          LEFT JOIN tasker_profiles tp ON t.id = tp.user_id
          WHERE tr.sender_id = $1

          UNION ALL

          -- Open Tasks
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

          ORDER BY created_at DESC
        `;

        const result = await client.query(query, [sender_id]);
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
          budget: row.budget
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
              WHEN tr.status = 'Waiting for Payment' THEN tr.hourly_rate
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
          WHERE tr.tasker_id = $1
          ORDER BY tr.created_at DESC
        `;

        const result = await client.query(query, [tasker_id]);
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
              WHEN tr.status = 'Waiting for Payment' THEN tr.hourly_rate
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
    try {
      const user_id = req.user.id;
      const task_id = req.params.id;
      const { status } = req.body;

      console.log('Updating task request ID:', task_id, 'for user ID:', user_id, 'with status:', status);

      if (!status) {
        return res.status(400).json({
          error: 'Status is required in request body',
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // First get the tasker's profile
        const taskerProfileResult = await client.query(
          'SELECT id FROM tasker_profiles WHERE user_id = $1',
          [user_id],
        );

        if (taskerProfileResult.rows.length === 0) {
          return res.status(403).json({
            error: 'Tasker profile not found',
          });
        }

        const _tasker_profile_id = taskerProfileResult.rows[0].id;

        // Map 'Accepted' to 'Waiting for Payment'
        const newStatus = status === 'Accepted' ? 'Waiting for Payment' : status;

        // Update the status using tasker_profile_id
        const updateResult = await client.query(`
          UPDATE task_requests
          SET status = $1 
          WHERE id = $2 
          AND tasker_id = $3
          RETURNING id
        `, [newStatus, task_id, user_id]);

        if (updateResult.rows.length === 0) {
          return res.status(404).json({
            error: 'Task request not found or you do not have permission to update it',
          });
        }

        // If status is completed, handle payment completion
        if (newStatus.toLowerCase() === 'completed') {
          // Get the payment record
          const payment = await Payment.getByTaskRequestId(task_id);
          if (!payment) {
            throw new Error('Payment record not found');
          }

          // Update payment status to completed
          await Payment.updateStatusToCompleted(task_id);

          // Update tasker's wallet
          const amountInCents = Math.round(payment.amount * 100);
          await User.updateWalletAmount(user_id, amountInCents);
          console.log(`Updated wallet for tasker ${user_id} with amount ${amountInCents} cents`);
        }

        // Get updated task request details
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
            CASE 
              WHEN tr.status = 'Waiting for Payment' THEN tr.hourly_rate
              ELSE tp.hourly_rate
            END as tasker_hourly_rate,
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
          WHERE tr.id = $1
        `;

        const result = await client.query(query, [task_id]);

        await client.query('COMMIT');

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

        console.log('Updated task request:', JSON.stringify(taskRequest, null, 2));
        res.json(taskRequest);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating task request status:', error);
      res.status(500).json({
        error: 'Failed to update task request status',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
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
              WHEN tr.status = 'Waiting for Payment' THEN tr.hourly_rate
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
            budget: row.budget
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
      // First get the user's wallet amount
      const userQuery = `
        SELECT wallet_amount 
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
        AND p.status = 'completed'
        ORDER BY p.created_at DESC
      `;

      const transactionsResult = await client.query(transactionsQuery, [userId]);

      // Format the response
      const response = {
        wallet_amount: userResult.rows[0].wallet_amount || 0,
        transactions: transactionsResult.rows.map((row) => ({
          payment_id: row.payment_id,
          amount: row.is_payment ? row.amount * -1 : row.amount, // Negative for payments made, positive for earnings
          payment_date: row.payment_date,
          payment_status: row.payment_status,
          transaction_type: row.is_payment ? 'payment' : 'earning',
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
        is_tasker: result.rows[0].is_tasker 
      });
      
    } catch (error) {
      console.error('Error checking if user is tasker:', error);
      res.status(500).json({ 
        error: 'Failed to check tasker status',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  },
};

module.exports = {
  ...taskerController,
  uploadFields,
};
