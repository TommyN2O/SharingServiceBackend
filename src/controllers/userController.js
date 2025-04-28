const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TaskerProfile = require('../models/TaskerProfile');
const CustomerRequest = require('../models/CustomerRequest');
const Message = require('../models/Message');
const pool = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/jwt');
require('dotenv').config();

const userController = {
  // Get total number of users
  async getUserCount(req, res) {
    try {
      const totalUsers = await User.getTotalUsers();
      res.status(200).json({ total_users: totalUsers });
    } catch (error) {
      console.error('Error getting user count:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Register new user
  async register(req, res) {
    try {
      const { name, surname, email, password, date_of_birth, dateOfBirth, birthDate } = req.body;
      // Try all possible date field names
      const finalBirthDate = date_of_birth || dateOfBirth || birthDate;
      
      console.log('Received registration request:', { name, surname, email, birthDate: finalBirthDate });

      // Validate required fields
      if (!name || !surname || !email || !password || !finalBirthDate) {
        console.log('Missing required fields:', { name, surname, email, birthDate: finalBirthDate });
        return res.status(400).json({
          error: 'Missing required fields',
          missing: {
            name: !name,
            surname: !surname,
            email: !email,
            password: !password,
            birthDate: !finalBirthDate
          }
        });
      }

      // Check if user already exists
      const existingUser = await User.getByEmail(email);
      if (existingUser) {
        console.log('User already exists:', email);
        return res.status(409).json({
          error: 'User with this email already exists'
        });
      }

      // Create new user using createUser method
      const user = await User.createUser({
        name,
        surname,
        email,
        password,
        date_of_birth: finalBirthDate
      });

      // Use createToken method instead of generating new token
      const token = await User.createToken(user.id);

      console.log('User registered successfully:', {
        userId: user.id,
        email: user.email,
        dateOfBirth: user.date_of_birth
      });

      res.status(201).json({
        user: {
          id: user.id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          date_of_birth: user.date_of_birth,
          profile_photo: ''
        },
        token
      });
    } catch (error) {
      console.error('Error registering user:', error);
      
      // Handle specific database errors
      if (error.code === '23505' && error.constraint === 'users_email_key') {
        return res.status(409).json({
          error: 'User with this email already exists'
        });
      }

      res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // Login user
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Get user by email with token information
      const user = await User.getByEmail(email);
      if (!user) {
        return res.status(401).json({
          error: 'Invalid credentials'
        });
      }

      // Verify password
      const isValidPassword = await User.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          error: 'Invalid credentials'
        });
      }

      // Get token (will reuse existing valid token or create new one)
      const token = await User.createToken(user.id);
      console.log('Login successful - Token:', token ? 'provided' : 'not provided');

      // Check if user is a tasker
      const taskerProfile = await TaskerProfile.findByUserId(user.id);

      res.status(200).json({
        user: {
          id: user.id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          date_of_birth: user.date_of_birth,
          isTasker: !!taskerProfile
        },
        token
      });
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // Get user dashboard
  async getDashboard(req, res) {
    try {
      const dashboard = await User.getUserDashboard(req.user.id);
      res.json(dashboard);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get user profile
  async getProfile(req, res) {
    try {
      console.log('Getting profile for user ID:', req.user.id);
      const userId = req.user.id; // From auth middleware
      const user = await User.getById(userId);
      console.log('User data from DB:', user);
      
      if (!user) {
        console.log('User not found in database');
        return res.status(404).json({
          error: 'User not found'
        });
      }

      const response = {
        id: user.id,
        name: user.name,
        surname: user.surname,
        email: user.email,
        date_of_birth: user.date_of_birth,
        created_at: user.created_at,
        is_tasker: user.is_tasker,
        profile_photo: user.profile_photo || ''
      };
      console.log('Sending response:', response);

      res.status(200).json(response);
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  },

  // Update user profile with image
  async updateUserProfile(req, res) {
    try {
      console.log('Updating user profile:', req.user.id);
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const userId = req.user.id;
      
      // Parse the profile_data from the request body
      let userData;
      try {
        userData = JSON.parse(req.body.profile_data);
        console.log('Parsed profile data:', userData);
      } catch (error) {
        console.error('Error parsing profile data:', error);
        return res.status(400).json({
          error: 'Invalid profile data'
        });
      }

      // Map the fields from the request to our database fields
      const { fullname, surname, birthdate } = userData;

      // Get current user data
      const currentUser = await User.getById(userId);
      console.log('Current user data:', currentUser);

      // Prepare update data
      const updateData = {
        name: fullname,
        surname,
        date_of_birth: birthdate
      };

      // Handle profile photo if provided
      if (req.files && req.files.profile_photo) {
        const file = req.files.profile_photo[0];
        const photoPath = `images/profiles/${file.filename}`;
        console.log('New profile photo path:', photoPath);
        
        // Update profile photo separately
        await User.updateProfilePhoto(userId, photoPath);
      }

      console.log('Update data:', updateData);

      // Update user data
      const updatedUser = await User.update(userId, updateData);
      console.log('Updated user data:', updatedUser);

      // Get the latest user data to ensure we have the correct profile photo
      const finalUser = await User.getById(userId);
      console.log('Final user data:', finalUser);

      res.status(200).json({
        id: finalUser.id,
        name: finalUser.name,
        surname: finalUser.surname,
        email: finalUser.email,
        date_of_birth: finalUser.date_of_birth,
        created_at: finalUser.created_at,
        is_tasker: finalUser.is_tasker,
        profile_photo: finalUser.profile_photo || ''
      });
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  },

  // Get user's customer requests
  async getCustomerRequests(req, res) {
    try {
      const requests = await CustomerRequest.findByUserId(req.user.id);
      res.json(requests);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get user's saved taskers
  async getSavedTaskers(req, res) {
    try {
      const taskers = await User.getUserWithSavedTaskers(req.user.id);
      res.json(taskers);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Save a tasker
  async saveTasker(req, res) {
    try {
      const { taskerId } = req.body;
      const savedTasker = await pool.query(
        'INSERT INTO saved_taskers (customer_id, tasker_id) VALUES ($1, $2) RETURNING *',
        [req.user.id, taskerId]
      );
      res.status(201).json(savedTasker.rows[0]);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get user's messages
  async getMessages(req, res) {
    try {
      const conversations = await Message.getRecentConversations(req.user.id);
      res.json(conversations);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get conversation with specific user
  async getConversation(req, res) {
    try {
      const { userId } = req.params;
      const messages = await Message.getConversation(req.user.id, userId);
      res.json(messages);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get all users
  async getAllUsers(req, res) {
    try {
      const users = await User.getAllUsers();
      res.status(200).json({
        users,
        total: users.length
      });
    } catch (error) {
      console.error('Error getting all users:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  },

  // Get user credentials by ID
  async getUserCredentials(req, res) {
    try {
      const userId = req.params.id;
      const user = await User.getCredentialsById(userId);
      
      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.status(200).json({
        user: {
          id: user.id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          password_hash: user.password_hash,
          date_of_birth: user.date_of_birth,
          created_at: user.created_at
        }
      });
    } catch (error) {
      console.error('Error getting user credentials:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  },

  // Get user by ID
  async getUserById(req, res) {
    try {
      const userId = req.params.id;
      const user = await User.getUserDetailsById(userId);
      
      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.status(200).json({
        user: {
          id: user.id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          date_of_birth: user.date_of_birth,
          created_at: user.created_at,
          is_tasker: user.is_tasker,
          profile_photo: user.profile_photo || '',
          password_hash: user.password_hash
        }
      });
    } catch (error) {
      console.error('Error getting user details:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  },

  // Get complete user data
  async getUserCompleteData(req, res) {
    try {
      const userId = req.params.id;
      console.log('Getting complete data for user:', userId);
      
      // Get user with tasker profile
      const user = await User.getUserWithTaskerProfile(userId);
      console.log('User data:', user);
      
      if (!user) {
        console.log('User not found');
        return res.status(404).json({ error: 'User not found' });
      }

      // If user is a tasker, get their complete profile
      let taskerProfile = null;
      if (user.is_tasker) {
        console.log('User is a tasker, getting profile');
        taskerProfile = await TaskerProfile.getCompleteProfile(userId);
        console.log('Tasker profile:', taskerProfile);
      }

      // Get user's dashboard data
      console.log('Getting dashboard data');
      const dashboard = await User.getUserDashboard(userId);
      console.log('Dashboard data:', dashboard);

      // Combine all data
      const completeData = {
        user: {
          id: user.id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          date_of_birth: user.date_of_birth,
          is_tasker: user.is_tasker,
          created_at: user.created_at
        },
        tasker_profile: user.is_tasker ? {
          id: user.tasker_profile_id,
          profile_photo: user.profile_photo,
          description: user.tasker_description,
          hourly_rate: user.hourly_rate,
          categories: taskerProfile?.categories || [],
          cities: taskerProfile?.cities || [],
          availability: taskerProfile?.availability || []
        } : null,
        dashboard: dashboard
      };

      console.log('Sending complete data:', completeData);
      res.json(completeData);
    } catch (error) {
      console.error('Error getting user complete data:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Remove saved tasker
  async removeSavedTasker(req, res) {
    try {
      const { taskerId } = req.params;
      await pool.query(
        'DELETE FROM saved_taskers WHERE customer_id = $1 AND tasker_id = $2',
        [req.user.id, taskerId]
      );
      res.status(200).json({ message: 'Tasker removed from saved list' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};

module.exports = userController; 