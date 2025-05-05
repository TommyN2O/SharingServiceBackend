const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

console.log('Loading JWT configuration...');

// Use a consistent secret key
const JWT_SECRET = 'sharing_service_secret_key_2024';
const JWT_EXPIRES_IN = '14d';

console.log('JWT configuration loaded');

// Export the configuration
module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
};
