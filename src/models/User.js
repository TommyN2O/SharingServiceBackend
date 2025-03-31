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
      SELECT u.*, 
             CASE WHEN tp.id IS NOT NULL THEN true ELSE false END as is_tasker,
             tp.*
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
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM customer_requests WHERE user_id = $1) as total_requests,
        (SELECT COUNT(*) FROM planned_tasks WHERE customer_id = $1 AND status = 'completed') as completed_tasks,
        (SELECT COUNT(*) FROM planned_tasks WHERE tasker_id = $1 AND status = 'completed') as completed_tasker_tasks,
        (SELECT AVG(rating) FROM reviews WHERE tasker_id = $1) as average_rating
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  async createUserTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(query);
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
  async create(userData) {
    const { name, surname, email, password, date_of_birth } = userData;
    const password_hash = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO ${this.tableName} (name, surname, email, password_hash, date_of_birth)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, surname, email, date_of_birth, created_at
    `;
    const result = await pool.query(query, [name, surname, email, password_hash, date_of_birth]);
    return result.rows[0];
  }

  // Update user
  async update(id, updates) {
    const { name, surname, date_of_birth } = updates;
    const query = `
      UPDATE ${this.tableName}
      SET name = $1, surname = $2, date_of_birth = $3
      WHERE id = $4
      RETURNING id, name, surname, email, date_of_birth, created_at
    `;
    const result = await pool.query(query, [name, surname, date_of_birth, id]);
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
}

module.exports = new User(); 