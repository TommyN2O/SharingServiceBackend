const pool = require('../config/database');
const PayoutRequest = require('../models/PayoutRequest');

const payoutController = {
  // Request a payout
  async requestPayout(req, res) {
    const client = await pool.connect();
    try {
      const userId = req.user.id;
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          error: 'Invalid amount. Amount must be greater than 0',
        });
      }

      await client.query('BEGIN');

      // Get user's wallet amount and IBAN
      const userQuery = `
        SELECT wallet_amount, wallet_bank_iban 
        FROM users 
        WHERE id = $1
      `;
      const userResult = await client.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { wallet_amount, wallet_bank_iban } = userResult.rows[0];

      // Check if user has provided their IBAN
      if (!wallet_bank_iban) {
        return res.status(400).json({
          error: 'Bank IBAN not set. Please set your bank IBAN before requesting a payout',
        });
      }

      // Check if wallet has enough funds
      if (wallet_amount < amount) {
        return res.status(400).json({
          error: 'Insufficient funds in wallet',
          required: amount,
          available: wallet_amount,
        });
      }

      // Deduct amount from wallet
      const newWalletAmount = wallet_amount - amount;
      await client.query(
        'UPDATE users SET wallet_amount = $1 WHERE id = $2',
        [newWalletAmount, userId],
      );

      // Create payout request
      const payoutRequest = await PayoutRequest.createPayoutRequest(userId, amount);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Payout request created successfully',
        payout_request: {
          ...payoutRequest,
          amount: payoutRequest.amount, // Amount is already in decimal format
        },
        remaining_balance: newWalletAmount,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating payout request:', error);
      res.status(500).json({
        error: 'Failed to create payout request',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      client.release();
    }
  },

  // Get user's payout requests
  async getPayoutRequests(req, res) {
    try {
      const userId = req.user.id;
      const payoutRequests = await PayoutRequest.getPayoutRequestsByUser(userId);

      // Format amounts from cents to euros
      const formattedPayoutRequests = payoutRequests.map(request => ({
        ...request,
        amount: request.amount / 100,
      }));

      res.json({
        success: true,
        payout_requests: formattedPayoutRequests,
      });
    } catch (error) {
      console.error('Error getting payout requests:', error);
      res.status(500).json({
        error: 'Failed to get payout requests',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
};

module.exports = payoutController; 