const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TaskerProfile = require('../models/TaskerProfile');
const CustomerRequest = require('../models/CustomerRequest');
const Message = require('../models/Message');
require('dotenv').config();

const userController = {
  // Get total number of users
  async getUserCount(req, res) {
    try {
      const totalUsers = await User.getTotalUsers();
      res.status(200).json({
        status: 'success',
        data: {
          total_users: totalUsers
        }
      });
    } catch (error) {
      console.error('Error getting user count:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  },

  // Register new user
  async register(req, res) {
    try {
      // Log the entire request body
      console.log('Full request body:', JSON.stringify(req.body, null, 2));
      
      // Handle both camelCase and snake_case field names
      const { 
        name, 
        surname, 
        email, 
        password, 
        date_of_birth,
        dateOfBirth // Add support for camelCase
      } = req.body;

      // Use either date_of_birth or dateOfBirth
      const birthDate = date_of_birth || dateOfBirth;

      // Log each field individually
      console.log('Parsed fields:', {
        name: name || 'undefined',
        surname: surname || 'undefined',
        email: email || 'undefined',
        date_of_birth: birthDate || 'undefined',
        hasPassword: !!password
      });

      // Validate required fields
      if (!name || !surname || !email || !password || !birthDate) {
        console.log('Missing required fields:', {
          hasName: !!name,
          hasSurname: !!surname,
          hasEmail: !!email,
          hasPassword: !!password,
          hasDateOfBirth: !!birthDate
        });
        return res.status(400).json({
          status: 'error',
          message: 'All fields are required: name, surname, email, password, date_of_birth',
          receivedFields: {
            name: !!name,
            surname: !!surname,
            email: !!email,
            password: !!password,
            date_of_birth: !!birthDate
          }
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid email format'
        });
      }

      // Validate date format
      const date = new Date(birthDate);
      if (isNaN(date.getTime())) {
        console.log('Invalid date received:', birthDate);
        return res.status(400).json({
          status: 'error',
          message: 'Invalid date format. Please provide a valid date.',
          receivedDate: birthDate
        });
      }

      // Check if user already exists
      const existingUser = await User.getByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          status: 'error',
          message: 'User with this email already exists'
        });
      }

      // Create new user using createUser method
      const user = await User.createUser({
        name,
        surname,
        email,
        password,
        date_of_birth: birthDate
      });

      // Generate token
      const token = User.generateToken(user);

      console.log('User registered successfully:', {
        userId: user.id,
        email: user.email,
        dateOfBirth: user.date_of_birth
      });

      res.status(201).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            name: user.name,
            surname: user.surname,
            email: user.email,
            date_of_birth: user.date_of_birth
          },
          token
        }
      });
    } catch (error) {
      console.error('Error registering user:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // Login user
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Get user by email
      const user = await User.getByEmail(email);
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid credentials'
        });
      }

      // Verify password
      const isValidPassword = await User.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid credentials'
        });
      }

      // Generate token
      const token = User.generateToken(user);

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            name: user.name,
            surname: user.surname,
            email: user.email,
            date_of_birth: user.date_of_birth
          },
          token
        }
      });
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
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
      const userId = req.user.id; // From auth middleware
      const user = await User.getById(userId);
      
      if (!user) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            name: user.name,
            surname: user.surname,
            email: user.email,
            date_of_birth: user.date_of_birth,
            created_at: user.created_at
          }
        }
      });
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  },

  // Update user profile
  async updateProfile(req, res) {
    try {
      const userId = req.user.id; // From auth middleware
      const { name, surname, date_of_birth } = req.body;

      const updatedUser = await User.update(userId, {
        name,
        surname,
        date_of_birth
      });

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: updatedUser.id,
            name: updatedUser.name,
            surname: updatedUser.surname,
            email: updatedUser.email,
            date_of_birth: updatedUser.date_of_birth,
            created_at: updatedUser.created_at
          }
        }
      });
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
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
        status: 'success',
        data: {
          users,
          total: users.length
        }
      });
    } catch (error) {
      console.error('Error getting all users:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
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
          status: 'error',
          message: 'User not found'
        });
      }

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            name: user.name,
            surname: user.surname,
            email: user.email,
            password_hash: user.password_hash,
            date_of_birth: user.date_of_birth,
            created_at: user.created_at
          }
        }
      });
    } catch (error) {
      console.error('Error getting user credentials:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
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
          status: 'error',
          message: 'User not found'
        });
      }

      // Format the response
      const userResponse = {
        id: user.id,
        name: user.name,
        surname: user.surname,
        email: user.email,
        date_of_birth: user.date_of_birth,
        created_at: user.created_at,
        is_tasker: user.is_tasker,
        password_hash: user.password_hash // Include hashed password for verification
      };

      res.status(200).json({
        status: 'success',
        data: {
          user: userResponse
        }
      });
    } catch (error) {
      console.error('Error getting user details:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  }
};

module.exports = userController; 