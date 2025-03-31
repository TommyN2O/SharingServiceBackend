const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authController = {
  // Register a new user
  async register(req, res) {
    try {
      const { name, surname, email, password, date_of_birth } = req.body;

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Create user
      const user = await User.createUser({
        name,
        surname,
        email,
        password,
        date_of_birth
      });

      // Generate token
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        status: 'success',
        message: 'User registered successfully',
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
      res.status(400).json({ error: error.message });
    }
  },

  // Login user
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Check password
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Get user with tasker profile to check role
      const userWithProfile = await User.getUserWithTaskerProfile(user.id);

      // Generate token
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email,
          isTasker: userWithProfile.is_tasker
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        status: 'success',
        message: 'Login successful',
        data: {
          user: {
            id: userWithProfile.id,
            name: userWithProfile.name,
            surname: userWithProfile.surname,
            email: userWithProfile.email,
            date_of_birth: userWithProfile.date_of_birth,
            is_tasker: userWithProfile.is_tasker
          },
          token
        }
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};

module.exports = authController; 