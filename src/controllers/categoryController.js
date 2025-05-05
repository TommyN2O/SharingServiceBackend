const Category = require('../models/Category');

const categoryController = {
  // Get all categories
  async getAllCategories(req, res) {
    try {
      console.log('Fetching all categories...');
      const categories = await Category.getAllCategories();
      console.log('Categories fetched successfully:', categories);
      res.status(200).json(categories);
    } catch (error) {
      console.error('Error getting categories:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        details: error.message,
      });
    }
  },

  // Get category by ID
  async getCategoryById(req, res) {
    try {
      console.log('Fetching category with ID:', req.params.id);
      const category = await Category.getById(req.params.id);

      if (!category) {
        console.log('Category not found:', req.params.id);
        return res.status(404).json({
          status: 'error',
          message: 'Category not found',
        });
      }

      console.log('Category found:', category);
      res.status(200).json({
        status: 'success',
        data: {
          category,
        },
      });
    } catch (error) {
      console.error('Error getting category:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        details: error.message,
      });
    }
  },

  // Create new category
  async createCategory(req, res) {
    try {
      console.log('Creating new category with data:', req.body);
      const { name, image_url, description } = req.body;

      // Validate required fields
      if (!name || !image_url) {
        console.log('Missing required fields:', { name, image_url });
        return res.status(400).json({
          status: 'error',
          message: 'Name and image URL are required',
        });
      }

      const category = await Category.create({
        name,
        image_url,
        description,
      });

      console.log('Category created successfully:', category);
      res.status(201).json({
        status: 'success',
        data: {
          category,
        },
      });
    } catch (error) {
      console.error('Error creating category:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        details: error.message,
      });
    }
  },

  // Update category
  async updateCategory(req, res) {
    try {
      console.log('Updating category:', req.params.id, 'with data:', req.body);
      const { name, image_url, description } = req.body;
      const categoryId = req.params.id;

      const category = await Category.update(categoryId, {
        name,
        image_url,
        description,
      });

      if (!category) {
        console.log('Category not found for update:', categoryId);
        return res.status(404).json({
          status: 'error',
          message: 'Category not found',
        });
      }

      console.log('Category updated successfully:', category);
      res.status(200).json({
        status: 'success',
        data: {
          category,
        },
      });
    } catch (error) {
      console.error('Error updating category:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        details: error.message,
      });
    }
  },

  // Delete category
  async deleteCategory(req, res) {
    try {
      console.log('Deleting category:', req.params.id);
      const category = await Category.delete(req.params.id);

      if (!category) {
        console.log('Category not found for deletion:', req.params.id);
        return res.status(404).json({
          status: 'error',
          message: 'Category not found',
        });
      }

      console.log('Category deleted successfully:', category);
      res.status(200).json({
        status: 'success',
        message: 'Category deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        details: error.message,
      });
    }
  },
};

module.exports = categoryController;
