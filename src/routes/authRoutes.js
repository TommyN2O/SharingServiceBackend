const express = require('express');

const router = express.Router();
const userController = require('../controllers/userController');

// Register new user
router.post('/register', userController.register);

// Login user
router.post('/login', userController.login);

// Test route for auth
router.get('/test', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Auth routes are working!',
  });
});

module.exports = router;
