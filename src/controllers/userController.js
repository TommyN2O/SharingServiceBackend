const _bcrypt = require('bcryptjs');
const _jwt = require('jsonwebtoken');
const User = require('../models/User');
const TaskerProfile = require('../models/TaskerProfile');
const Message = require('../models/Message');
const TaskRequest = require('../models/TaskRequest');
const FirebaseService = require('../services/firebaseService');
const pool = require('../config/database');

const { _JWT_SECRET, _JWT_EXPIRES_IN } = process.env;
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
      const {
        name, surname, email, password, date_of_birth, dateOfBirth, birthDate,
      } = req.body;
      // Try all possible date field names
      const finalBirthDate = date_of_birth || dateOfBirth || birthDate;

      console.log('Received registration request:', {
        name, surname, email, birthDate: finalBirthDate,
      });

      // Validate required fields
      if (!name || !surname || !email || !password || !finalBirthDate) {
        console.log('Missing required fields:', {
          name, surname, email, birthDate: finalBirthDate,
        });
        return res.status(400).json({
          error: 'Missing required fields',
          missing: {
            name: !name,
            surname: !surname,
            email: !email,
            password: !password,
            birthDate: !finalBirthDate,
          },
        });
      }

      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({
          error: 'Password must be at least 6 characters long',
        });
      }

      // Check if user already exists
      const existingUser = await User.getByEmail(email);
      if (existingUser) {
        console.log('User already exists:', email);
        return res.status(409).json({
          error: 'User with this email already exists',
        });
      }

      // Create new user using createUser method
      const user = await User.createUser({
        name,
        surname,
        email,
        password,
        date_of_birth: finalBirthDate,
      });

      // Use createToken method instead of generating new token
      const token = await User.createToken(user.id);

      console.log('User registered successfully:', {
        userId: user.id,
        email: user.email,
        dateOfBirth: user.date_of_birth,
      });

      res.status(201).json({
        user: {
          id: user.id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          date_of_birth: user.date_of_birth,
          profile_photo: '',
        },
        token,
      });
    } catch (error) {
      console.error('Error registering user:', error);

      // Handle specific database errors
      if (error.code === '23505' && error.constraint === 'users_email_key') {
        return res.status(409).json({
          error: 'User with this email already exists',
        });
      }

      res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
          error: 'Invalid credentials',
        });
      }

      // Verify password
      const isValidPassword = await User.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          error: 'Invalid credentials',
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
          isTasker: !!taskerProfile,
        },
        token,
      });
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
          error: 'User not found',
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
        profile_photo: user.profile_photo || '',
        wallet_bank_iban: user.wallet_bank_iban || null,
      };
      console.log('Sending response:', response);

      res.status(200).json(response);
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({
        error: 'Internal server error',
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
          error: 'Invalid profile data',
        });
      }

      // Map the fields from the request to our database fields
      const {
        fullname, surname, birthdate, wallet_bank_iban,
      } = userData;

      // Get current user data
      const currentUser = await User.getById(userId);
      console.log('Current user data:', currentUser);

      // Prepare update data
      const updateData = {
        name: fullname,
        surname,
        date_of_birth: birthdate,
      };

      // Add IBAN if provided
      if (wallet_bank_iban !== undefined) {
        updateData.wallet_bank_iban = wallet_bank_iban;
      }

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
        profile_photo: finalUser.profile_photo || '',
        wallet_bank_iban: finalUser.wallet_bank_iban || null,
      });
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({
        error: 'Internal server error',
      });
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
        total: users.length,
      });
    } catch (error) {
      console.error('Error getting all users:', error);
      res.status(500).json({
        error: 'Internal server error',
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
          error: 'User not found',
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
          created_at: user.created_at,
        },
      });
    } catch (error) {
      console.error('Error getting user credentials:', error);
      res.status(500).json({
        error: 'Internal server error',
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
          error: 'User not found',
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
          password_hash: user.password_hash,
        },
      });
    } catch (error) {
      console.error('Error getting user details:', error);
      res.status(500).json({
        error: 'Internal server error',
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
          created_at: user.created_at,
        },
        tasker_profile: user.is_tasker ? {
          id: user.tasker_profile_id,
          profile_photo: user.profile_photo,
          description: user.tasker_description,
          hourly_rate: user.hourly_rate,
          categories: taskerProfile?.categories || [],
          cities: taskerProfile?.cities || [],
          availability: taskerProfile?.availability || [],
        } : null,
        dashboard,
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
        [req.user.id, taskerId],
      );
      res.status(200).json({ message: 'Tasker removed from saved list' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Change user password
  async changePassword(req, res) {
    try {
      const userId = req.user.id; // From auth middleware
      const { currentPassword, newPassword } = req.body;

      // Validate input
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: 'Current password and new password are required',
        });
      }

      // Validate new password
      if (newPassword.length < 6) {
        return res.status(400).json({
          error: 'New password must be at least 6 characters long',
        });
      }

      // Update password using the User model instance
      await User.updatePassword(userId, currentPassword, newPassword);

      res.status(200).json({
        message: 'Password updated successfully',
      });
    } catch (error) {
      console.error('Error changing password:', error);

      if (error.message === 'Current password is incorrect') {
        return res.status(401).json({
          error: 'Current password is incorrect',
        });
      }

      if (error.message === 'User not found') {
        return res.status(404).json({
          error: 'User not found',
        });
      }

      res.status(500).json({
        error: 'Internal server error',
      });
    }
  },

  // Get wallet balance
  async getWalletBalance(req, res) {
    try {
      const userId = req.user.id;
      const query = 'SELECT wallet_amount FROM users WHERE id = $1';
      const result = await pool.query(query, [userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const walletAmount = result.rows[0].wallet_amount || 0;
      res.json({ balance: walletAmount }); // Amount is already in decimal format
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      res.status(500).json({
        error: 'Failed to get wallet balance',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Delete user account (deactivates by changing password)
  async deleteAccount(req, res) {
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check for active tasks as a sender
      const activeSentTasksQuery = `
        SELECT COUNT(*) as count
        FROM task_requests
        WHERE sender_id = $1
        AND status IN ('pending', 'Waiting for Payment', 'paid')
      `;
      const activeSentTasksResult = await client.query(activeSentTasksQuery, [userId]);

      if (activeSentTasksResult.rows[0].count > 0) {
        await client.query('ROLLBACK');
        return res.sendStatus(606); // Error code for active tasks as sender
      }

      // Check if user is a tasker
      const isTaskerQuery = 'SELECT is_tasker FROM users WHERE id = $1';
      const isTaskerResult = await client.query(isTaskerQuery, [userId]);
      const isTasker = isTaskerResult.rows[0]?.is_tasker;

      if (isTasker) {
        // Check for active tasks as a tasker
        const activeTaskerTasksQuery = `
          SELECT COUNT(*) as count
          FROM task_requests
          WHERE tasker_id = $1
          AND status IN ('pending', 'Waiting for Payment', 'paid')
        `;
        const activeTaskerTasksResult = await client.query(activeTaskerTasksQuery, [userId]);

        if (activeTaskerTasksResult.rows[0].count > 0) {
          await client.query('ROLLBACK');
          return res.sendStatus(605); // Error code for active tasks as tasker
        }

        // Delete tasker's availability
        await client.query('DELETE FROM tasker_availability WHERE tasker_id IN (SELECT id FROM tasker_profiles WHERE user_id = $1)', [userId]);
      }

      // Generate a random password that nobody will know
      const randomPassword = require('crypto').randomBytes(32).toString('hex');
      const salt = await _bcrypt.genSalt(10);
      const hashedPassword = await _bcrypt.hash(randomPassword, salt);

      // Update user status and password
      const updateQuery = `
        UPDATE users 
        SET 
          password_hash = $1,
          is_deactivated = true
        WHERE id = $2
        RETURNING id
      `;

      const updateResult = await client.query(updateQuery, [hashedPassword, userId]);

      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.sendStatus(500); // User not found or couldn't be updated
      }

      // Delete all active tokens for this user
      await client.query('DELETE FROM user_tokens WHERE user_id = $1', [userId]);

      await client.query('COMMIT');
      return res.sendStatus(200); // Success code
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deactivating user account:', error);
      return res.sendStatus(500); // General error code
    } finally {
      client.release();
    }
  },
};

module.exports = userController;
