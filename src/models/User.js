const BaseModel = require('./BaseModel');
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

class User extends BaseModel {
  constructor() {
    super('users');
  }

  // Custom methods specific to User model
  async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  async createUser(userData) {
    const { password, ...rest } = userData;
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    
    return this.create({
      ...rest,
      password_hash
    });
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
        average_rating: 0
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
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(query);
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
      SELECT id, name, surname, email, date_of_birth, created_at
      FROM ${this.tableName}
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Get user by email
  async getByEmail(email) {
    const query = `
      SELECT id, name, surname, email, password_hash, date_of_birth, created_at
      FROM ${this.tableName}
      WHERE email = $1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  // Create new user
  static async create({ name, surname, email, password, date_of_birth }) {
    try {
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      // Format date to YYYY-MM-DD if it's a string
      let formattedDate = date_of_birth;
      if (typeof date_of_birth === 'string') {
        // If the date is in a different format, convert it
        const date = new Date(date_of_birth);
        if (!isNaN(date)) {
          formattedDate = date.toISOString().split('T')[0];
        }
      }

      console.log('Creating user with date:', formattedDate);

      const result = await pool.query(
        'INSERT INTO users (name, surname, email, password_hash, date_of_birth) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [name, surname, email, password_hash, formattedDate]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  // Update user
  async update(id, data) {
    const allowedFields = ['name', 'surname', 'email', 'date_of_birth', 'is_tasker'];
    const updates = Object.keys(data)
      .filter(key => allowedFields.includes(key))
      .map(key => `${key} = $${allowedFields.indexOf(key) + 2}`)
      .join(', ');

    if (!updates) {
      throw new Error('No valid fields to update');
    }

    const values = [id, ...allowedFields.map(field => data[field])];
    const query = `
      UPDATE users
      SET ${updates}
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  // Generate JWT token
  generateToken(user) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        isTasker: false // This will be updated when tasker profile is created
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  // Verify password
  async verifyPassword(password, password_hash) {
    return bcrypt.compare(password, password_hash);
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
}

module.exports = new User(); 