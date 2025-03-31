const cors = require('cors');

const corsOptions = {
  origin: '*', // In production, replace with your Android app's domain
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

module.exports = cors(corsOptions); 