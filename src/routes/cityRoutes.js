const express = require('express');

const router = express.Router();
const City = require('../models/City');

// Get all cities
router.get('/', async (req, res) => {
  try {
    const cities = await City.getAll();
    res.json(cities);
  } catch (error) {
    console.error('Error getting cities:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset cities table
router.post('/reset', async (req, res) => {
  try {
    const result = await City.resetCities();
    res.json(result);
  } catch (error) {
    console.error('Error resetting cities:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
