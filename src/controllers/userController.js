const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TaskerProfile = require('../models/TaskerProfile');
const CustomerRequest = require('../models/CustomerRequest');
const Message = require('../models/Message');
require('dotenv').config();

const userController = {
  // Register new user
  async register(req, res) {
    try {
      const { name, surname, email, password, date_of_birth } = req.body;

      // Check if user already exists
      const existingUser = await User.getByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          status: 'error',
          message: 'User with this email already exists'
        });
      }

      // Create new user
      const user = await User.create({
        name,
        surname,
        email,
        password,
        date_of_birth
      });

      // Generate token
      const token = User.generateToken(user);

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
        message: 'Internal server error'
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
  }
};

module.exports = userController; 