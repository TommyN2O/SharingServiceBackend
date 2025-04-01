const BaseModel = require('./BaseModel');
const pool = require('../config/database');
const path = require('path');

class Category extends BaseModel {
  constructor() {
    super('categories');
  }

  // Create category table
  async createCategoryTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        image_url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(query);
  }

  // Create new category
  async create({ name, image_url, description }) {
    // Convert local file path to URL path
    const imageUrl = this.convertToImageUrl(image_url);
    
    const query = `
      INSERT INTO categories (name, image_url, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [name, imageUrl, description]);
    return result.rows[0];
  }

  // Get all categories
  async getAllCategories() {
    const query = `
      SELECT id, name, image_url, description, created_at
      FROM categories
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  // Get category by ID
  async getById(id) {
    const query = `
      SELECT id, name, image_url, description, created_at
      FROM categories
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Update category
  async update(id, { name, image_url, description }) {
    // Convert local file path to URL path if image_url is provided
    const imageUrl = image_url ? this.convertToImageUrl(image_url) : undefined;
    
    const query = `
      UPDATE categories
      SET name = $1, 
          image_url = COALESCE($2, image_url),
          description = $3
      WHERE id = $4
      RETURNING *
    `;
    const result = await pool.query(query, [name, imageUrl, description, id]);
    return result.rows[0];
  }

  // Delete category
  async delete(id) {
    const query = `
      DELETE FROM categories
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Helper method to convert local file path to URL path
  convertToImageUrl(localPath) {
    // Extract just the filename from the full path
    const fileName = path.basename(localPath);
    // Return the URL path that will be served by Express
    return `/images/categories/${fileName}`;
  }
}

module.exports = new Category(); 