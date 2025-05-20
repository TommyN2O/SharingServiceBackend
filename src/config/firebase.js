const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Initialize Firebase Admin with service account
let serviceAccount;
try {
  // First, try to get from environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      console.log('Using Firebase service account from environment variable');
    } catch (parseError) {
      console.error('Error parsing FIREBASE_SERVICE_ACCOUNT environment variable:', parseError);
    }
  }
  
  // If not in env, try to get from local file
  if (!serviceAccount) {
    const serviceAccountPath = path.join(__dirname, '..', 'bdnesthelper-firebase-adminsdk-fbsvc-aa3c8321f8.json');
    serviceAccount = require(serviceAccountPath);
    console.log('Using Firebase service account from local file');
  }
} catch (error) {
  console.error('Error loading Firebase service account:', error);
  process.exit(1);
}

// Initialize the admin SDK
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1);
}

module.exports = admin;