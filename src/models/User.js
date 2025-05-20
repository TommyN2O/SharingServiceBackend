const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const BaseModel = require('./BaseModel');
const pool = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/jwt');

const { _JWT_SECRET, _JWT_EXPIRES_IN } = process.env;
require('dotenv').config();

class User extends BaseModel {
  constructor() {
    super('users');
    this.initialize();
  }

  async initialize() {
    try {
      await this.createUserTable();
      await this.addCurrentTokenColumn();
      await this.addProfilePhotoColumn();
      await this.addWalletAmountColumn();
      console.log('User model initialized successfully');
    } catch (error) {
      console.error('Error initializing User model:', error);
    }
  }

  // Custom methods specific to User model
  async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  async createUser(userData) {
    try {
      // Check for existing user first
      const existingUser = await this.getByEmail(userData.email);
      if (existingUser) {
        const error = new Error('User with this email already exists');
        error.code = '23505';
        error.constraint = 'users_email_key';
        throw error;
      }

      const { password, ...rest } = userData;
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      return this.create({
        ...rest,
        password_hash,
      });
    } catch (error) {
      console.error('Error in createUser:', error);
      throw error;
    }
  }

  async getUserWithTaskerProfile(userId) {
    const query = `
      SELECT 
        u.id,
        u.name,
        u.surname,
        u.email,
        u.date_of_birth,
        u.created_at,
        CASE WHEN tp.id IS NOT NULL THEN true ELSE false END as is_tasker,
        tp.id as tasker_profile_id,
        tp.profile_photo,
        tp.description as tasker_description,
        tp.hourly_rate
      FROM users u
      LEFT JOIN tasker_profiles tp ON u.id = tp.user_id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  async getUserWithCustomerRequests(userId) {
    const query = `
      SELECT u.*, cr.*
      FROM users u
      LEFT JOIN customer_requests cr ON u.id = cr.user_id
      WHERE u.id = $1
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  async getUserWithSavedTaskers(userId) {
    const query = `
      SELECT t.*, tp.*
      FROM saved_taskers st
      JOIN users t ON st.tasker_id = t.id
      JOIN tasker_profiles tp ON t.id = tp.user_id
      WHERE st.customer_id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  async getUserDashboard(userId) {
    try {
      const query = `
        SELECT 
          COALESCE((SELECT COUNT(*) FROM customer_requests WHERE user_id = $1), 0) as total_requests,
          COALESCE((SELECT COUNT(*) FROM planned_tasks WHERE customer_id = $1 AND status = 'completed'), 0) as completed_tasks,
          COALESCE((SELECT COUNT(*) FROM planned_tasks WHERE tasker_id = $1 AND status = 'completed'), 0) as completed_tasker_tasks,
          COALESCE((SELECT AVG(rating) FROM reviews WHERE tasker_id = $1), 0) as average_rating
      `;
      const result = await pool.query(query, [userId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error getting user dashboard:', error);
      // Return default values if there's an error
      return {
        total_requests: 0,
        completed_tasks: 0,
        completed_tasker_tasks: 0,
        average_rating: 0,
      };
    }
  }

  // Create user table
  async createUserTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        surname VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        date_of_birth DATE NOT NULL,
        is_tasker BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        token_created_at TIMESTAMP DEFAULT NOW(),
        current_token TEXT,
        profile_photo TEXT DEFAULT '',
        wallet_amount INTEGER DEFAULT 0
      )
    `;
    await pool.query(query);
  }

  // Add current_token column if it doesn't exist
  async addCurrentTokenColumn() {
    const query = `
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' 
          AND column_name = 'current_token'
        ) THEN 
          ALTER TABLE users ADD COLUMN current_token TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' 
          AND column_name = 'token_created_at'
        ) THEN 
          ALTER TABLE users ADD COLUMN token_created_at TIMESTAMP DEFAULT NOW();
        END IF;
      END $$;
    `;
    await pool.query(query);
  }

  // Add profile_photo column if it doesn't exist
  async addProfilePhotoColumn() {
    const query = `
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' 
          AND column_name = 'profile_photo'
        ) THEN 
          ALTER TABLE users ADD COLUMN profile_photo TEXT DEFAULT '';
        END IF;
      END $$;
    `;
    await pool.query(query);
  }

  // Add wallet_amount column if it doesn't exist
  async addWalletAmountColumn() {
    const query = `
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' 
          AND column_name = 'wallet_amount'
        ) THEN 
          ALTER TABLE users ADD COLUMN wallet_amount INTEGER DEFAULT 0;
        END IF;
      END $$;
    `;
    await pool.query(query);
    console.log('Wallet amount column added successfully');
  }

  // Get all users (without sensitive data)
  async getAllUsers() {
    const query = `
      SELECT id, name, surname, email, date_of_birth, created_at
      FROM ${this.tableName}
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  // Get total number of users
  async getTotalUsers() {
    const query = `
      SELECT COUNT(*) as total
      FROM ${this.tableName}
    `;
    const result = await pool.query(query);
    return result.rows[0].total;
  }

  // Get user by ID
  async getById(id) {
    const query = `
      SELECT id, name, surname, email, date_of_birth, created_at, token_created_at, current_token, is_tasker, profile_photo
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Get user by email
  async getByEmail(email) {
    const query = `
      SELECT id, name, surname, email, password_hash, date_of_birth, created_at, token_created_at, current_token
      FROM ${this.tableName}
      WHERE email = $1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  // Create new user
  static async create({
    name, surname, email, password, date_of_birth,
  }) {
    try {
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      // Format date to YYYY-MM-DD
      let formattedDate;
      if (date_of_birth instanceof Date) {
        formattedDate = date_of_birth.toISOString().split('T')[0];
      } else if (typeof date_of_birth === 'string') {
        // If it's already in YYYY-MM-DD format, use it as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
          formattedDate = date_of_birth;
        } else {
          // Try to parse the date string
          const date = new Date(date_of_birth);
          if (!isNaN(date)) {
            formattedDate = date.toISOString().split('T')[0];
          } else {
            formattedDate = date_of_birth; // Use as is if we can't parse it
          }
        }
      } else {
        formattedDate = date_of_birth; // Use as is for any other format
      }

      console.log('Creating user with date:', formattedDate);

      const result = await pool.query(
        'INSERT INTO users (name, surname, email, password_hash, date_of_birth) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [name, surname, email, password_hash, formattedDate],
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  // Update user
  async update(id, data) {
    const allowedFields = ['name', 'surname', 'email', 'date_of_birth', 'is_tasker', 'token_created_at', 'current_token', 'profile_photo'];

    // Filter out undefined values and non-allowed fields
    const updateFields = Object.entries(data)
      .filter(([key, value]) => allowedFields.includes(key) && value !== undefined)
      .map(([key]) => key);

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Create the SET part of the query and values array
    const updates = updateFields
      .map((field, index) => `${field} = $${index + 2}`)
      .join(', ');

    const values = [id, ...updateFields.map((field) => data[field])];

    const query = `
      UPDATE users
      SET ${updates}
      WHERE id = $1
      RETURNING id, name, surname, email, date_of_birth, created_at, is_tasker, profile_photo
    `;

    console.log('Update query:', query);
    console.log('Update values:', values);

    const result = await pool.query(query, values);
    console.log('Update result:', result.rows[0]);

    if (!result.rows[0]) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }

  // Verify password
  async verifyPassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }

  // Get user credentials by ID
  static async getCredentialsById(id) {
    const query = `
      SELECT id, name, surname, email, password_hash, date_of_birth, created_at
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Get user by ID with all details
  async getUserById(id) {
    const query = `
      SELECT 
        id,
        name,
        surname,
        email,
        password_hash,
        date_of_birth,
        created_at,
        profile_photo,
        CASE 
          WHEN EXISTS (SELECT 1 FROM tasker_profiles WHERE user_id = users.id) 
          THEN true 
          ELSE false 
        END as is_tasker
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Get user details by ID
  async getUserDetailsById(id) {
    const query = `
      SELECT 
        id,
        name,
        surname,
        email,
        password_hash,
        date_of_birth,
        created_at,
        profile_photo,
        CASE 
          WHEN EXISTS (SELECT 1 FROM tasker_profiles WHERE user_id = users.id) 
          THEN true 
          ELSE false 
        END as is_tasker
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Update user to become a tasker
  async becomeTasker(userId) {
    const query = `
      UPDATE users
      SET is_tasker = TRUE
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  async createToken(userId) {
    try {
      const client = await pool.connect();
      try {
        // Create a new token using the consistent JWT secret
        const token = jwt.sign(
          { userId },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRES_IN }
        );

        // Update the user's current token and token creation time
        const updateQuery = `
          UPDATE users 
          SET current_token = $1, token_created_at = NOW() 
          WHERE id = $2
          RETURNING id, email, name, surname
        `;
        await client.query(updateQuery, [token, userId]);

        return token;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating token:', error);
      throw error;
    }
  }

  // Update user's profile photo
  async updateProfilePhoto(userId, photoPath) {
    const query = `
      UPDATE users
      SET profile_photo = $2
      WHERE id = $1
      RETURNING id, name, surname, email, date_of_birth, created_at, is_tasker, profile_photo
    `;
    const result = await pool.query(query, [userId, photoPath]);
    return result.rows[0];
  }

  // Update user's wallet amount
  async updateWalletAmount(userId, amountInCents) {
    const query = 'UPDATE users SET wallet_amount = wallet_amount + $1 WHERE id = $2 RETURNING *';
    const result = await pool.query(query, [amountInCents, userId]);
    return result.rows[0];
  }

  // Update user password
  async updatePassword(userId, currentPassword, newPassword) {
    try {
      // Get user with current password hash
      const query = `
        SELECT id, password_hash
        FROM users
        WHERE id = $1
      `;
      const result = await pool.query(query, [userId]);
      const user = result.rows[0];

      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      // Update password in database
      const updateQuery = 'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id';
      const updateResult = await pool.query(updateQuery, [newPasswordHash, userId]);
      return updateResult.rows[0];
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new User();
