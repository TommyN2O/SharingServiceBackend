const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
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
  getTaskById,
  getPaidTasksSent,
  getPaidTasksReceived,
  getSentCompletedTasks,
  getReceivedCompletedTasks,
  getWalletPayments,
  checkIfTasker,
  convertToOpenTask,
  cleanupExpiredAvailability,
} = require('../controllers/taskerController');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Profile routes
router.get('/profile', getProfile);
router.post('/profile', uploadFields, createProfile);
router.put('/profile', uploadFields, updateProfile);
router.delete('/profile', deleteProfile);

// Task management routes
router.get('/tasks', getTasks);
router.get('/tasks/available', getAvailableTasks);

// Task request routes - specific routes first
router.get('/tasks/sent/completed', getSentCompletedTasks);
router.get('/tasks/received/completed', getReceivedCompletedTasks);
router.get('/tasks/sent/paid', getPaidTasksSent);
router.get('/tasks/received/paid', getPaidTasksReceived);
router.get('/tasks/sent', getTasksBySender);
router.get('/tasks/received', getTaskRequestsReceived);

// Wallet payments route
router.get('/walletpayments', getWalletPayments);

// Task request routes - parameterized routes last
router.get('/tasks/sent/:id', getTaskById);
router.get('/tasks/received/:id', getTaskRequestById);
router.post('/tasks/:taskId/offer', sendOffer);
router.post('/tasks/:taskId/accept', acceptTask);
router.put('/tasks/:taskId/status', updateTaskStatus);
router.put('/tasks/received/:id/status', updateTaskRequestStatus);
router.put('/task-requests/:id/convert-to-open', convertToOpenTask);

// Task creation route
router.post('/send-request', uploadFields, sendTaskRequest);

// Profile listing routes
router.get('/profiles', getAllProfiles);
router.get('/profiles/:id', getProfileById);

// Availability management
router.put('/availability', updateAvailability);
router.post('/availability/cleanup', cleanupExpiredAvailability);

// Test endpoints
router.post('/test/data', insertTestData);

// Check if user is a tasker
router.get('/check', checkIfTasker);

module.exports = router;
