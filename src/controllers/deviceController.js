const UserDevice = require('../models/UserDevice');

const deviceController = {
  // Register a device token
  async registerToken(req, res) {
    try {
      const userId = req.user.id;
      const { deviceToken } = req.body;

      if (!deviceToken) {
        return res.status(400).json({
          error: 'Device token is required',
        });
      }

      console.log('Registering device token for user:', userId);
      const device = await UserDevice.addDeviceToken(userId, deviceToken);
      console.log('Device token registered:', device);

      res.status(201).json({
        success: true,
        message: 'Device token registered successfully',
        device,
      });
    } catch (error) {
      console.error('Error registering device token:', error);
      res.status(500).json({
        error: 'Failed to register device token',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Remove a device token
  async removeToken(req, res) {
    try {
      const { deviceToken } = req.body;

      if (!deviceToken) {
        return res.status(400).json({
          error: 'Device token is required',
        });
      }

      await UserDevice.removeDeviceToken(deviceToken);
      console.log('Device token removed:', deviceToken);

      res.json({
        success: true,
        message: 'Device token removed successfully',
      });
    } catch (error) {
      console.error('Error removing device token:', error);
      res.status(500).json({
        error: 'Failed to remove device token',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
};

module.exports = deviceController;
