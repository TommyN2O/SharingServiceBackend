const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const OpenTaskController = require('../controllers/OpenTaskController');
const { authenticateToken, isTasker } = require('../middleware/auth');

// Middleware to handle trailing slashes
router.use((req, res, next) => {
  if (req.path.slice(-1) === '/' && req.path.length > 1) {
    // Keep the query string when redirecting
    const query = req.url.slice(req.path.length);
    const newPath = req.path.slice(0, -1) + query;
    res.redirect(301, newPath);
  } else {
    next();
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../public/images/tasks'));
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  console.log('Processing file:', file);
  // Accept images only
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    files: 5 // Maximum 5 files
  }
}).array('galleryImages', 5);

const openTaskController = new OpenTaskController();

// Create a new open task
router.post('/', authenticateToken, (req, res, next) => {
  console.log('Received request headers:', req.headers);
  
  upload(req, res, (err) => {
    console.log('Multer processing complete');
    console.log('Request body after multer:', req.body);
    console.log('Request files after multer:', req.files);
    
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: err.message });
    } else if (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'File upload failed', details: err.message });
    }
    next();
  });
}, openTaskController.createOpenTask);

// Get all open tasks with filters - handle both with and without trailing slash
router.get(['/', '//'], openTaskController.getAllOpenTasks);

// Get tasks by category
router.get('/category/:categoryId',
  openTaskController.getTasksByCategory
);

// Get open task by ID
router.get('/:id',
  openTaskController.getOpenTaskById
);

// Delete expired dates
router.delete('/dates/expired', authenticateToken, openTaskController.deleteExpiredDates);

// Delete open task
router.delete('/:id', 
  authenticateToken,
  openTaskController.deleteOpenTask
);

// Get dates for a specific open task
router.get('/:taskId/dates', openTaskController.getOpenTaskDates);

// Get all offers for a specific task
router.get('/:taskId/offers', openTaskController.getTaskOffers);

// Get specific offer by ID
router.get('/offers/:offerId', openTaskController.getOfferById);

// Create an offer for a task
router.post('/:taskId/offers',
  authenticateToken,
  isTasker,
  openTaskController.createOffer
);

// Accept an offer
router.post('/offers/:offerId/accept',
  authenticateToken,
  openTaskController.acceptOffer
);

module.exports = router; 