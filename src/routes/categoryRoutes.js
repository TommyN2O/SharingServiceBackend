const express = require('express');

const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const categoryController = require('../controllers/categoryController');

// Public routes
router.get('/', categoryController.getAllCategories);
router.get('/:id', categoryController.getCategoryById);
router.post('/', categoryController.createCategory);

// Protected routes (admin only)
router.use(authenticateToken);
router.put('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);

module.exports = router;
