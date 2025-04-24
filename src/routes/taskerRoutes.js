const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getProfile,
  createProfile,
  updateProfile,
  getAvailableTasks,
  sendOffer,
  acceptTask,
  getTasks,
  updateTaskStatus,
  deleteProfile,
  getAllProfiles,
  getProfileById,
  updateAvailability,
  uploadFields,
  sendTaskRequest,
  getTasksBySender,
  getTaskRequestsReceived,
  getTaskRequestById,
  insertTestData,
  updateTaskRequestStatus,
  getTaskById
} = require('../controllers/taskerController');

// Apply authentication middleware to all routes
router.use(auth);

// Profile routes
router.get('/profile', getProfile);
router.post('/profile', uploadFields, createProfile);
router.put('/profile', uploadFields, updateProfile);
router.delete('/profile', deleteProfile);

// Task management routes
router.get('/tasks', getTasks);
router.get('/tasks/available', getAvailableTasks);
router.post('/tasks/:taskId/offer', sendOffer);
router.post('/tasks/:taskId/accept', acceptTask);
router.put('/tasks/:taskId/status', updateTaskStatus);

// Task request routes
router.post('/send-request', uploadFields, sendTaskRequest);
router.get('/tasks/sent', getTasksBySender);
router.get('/tasks/sent/:id', getTaskById);
router.get('/tasks/received', getTaskRequestsReceived);
router.get('/tasks/received/:id', getTaskRequestById);
router.put('/tasks/received/:id/status', updateTaskRequestStatus);

// Profile listing routes
router.get('/profiles', getAllProfiles);
router.get('/profiles/:id', getProfileById);

// Availability management
router.put('/profile/availability', updateAvailability);

// Test endpoints
router.post('/test/data', insertTestData);

module.exports = router; 