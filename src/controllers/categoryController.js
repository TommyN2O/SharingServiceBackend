const Category = require('../models/Category');

const categoryController = {
  // Get all categories
  async getAllCategories(req, res) {
    try {
      const categories = await Category.findAll();
      res.json(categories);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Get category by ID
  async getCategoryById(req, res) {
    try {
      const category = await Category.findById(req.params.id);
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Create new category
  async createCategory(req, res) {
    try {
      const { name, description } = req.body;
      const category = await Category.create({ name, description });
      res.status(201).json(category);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Update category
  async updateCategory(req, res) {
    try {
      const { name, description } = req.body;
      const category = await Category.update(req.params.id, { name, description });
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  // Delete category
  async deleteCategory(req, res) {
    try {
      const category = await Category.delete(req.params.id);
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json({ message: 'Category deleted successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};

module.exports = categoryController; 