const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const leadRoutes = require('./leadRoutes');
const listRoutes = require('./listRoutes');

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/leads', leadRoutes);
router.use('/lists', listRoutes);

module.exports = router;