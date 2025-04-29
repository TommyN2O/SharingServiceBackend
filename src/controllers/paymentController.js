const stripe = require('../config/stripe');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const Payment = require('../models/Payment');
const TaskRequest = require('../models/TaskRequest');
const User = require('../models/User');

const paymentController = {
  // Create a checkout session
  async createCheckoutSession(req, res) {
    try {
      const { amount, task_id, type } = req.body;

      if (!amount || !task_id || !type) {
        return res.status(400).json({
          error: 'Missing required parameters: amount, task_id, and type are required'
        });
      }

      if (!['Card', 'Wallet'].includes(type)) {
        return res.status(400).json({
          error: 'Invalid payment type. Must be either "Card" or "Wallet"'
        });
      }

      // Get task request to find tasker_id
      const taskRequest = await TaskRequest.findById(task_id);
      if (!taskRequest) {
        return res.status(404).json({ error: 'Task request not found' });
      }

      // Handle wallet payment
      if (type === 'Wallet') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Get user's wallet amount
          const userQuery = 'SELECT wallet_amount FROM users WHERE id = $1';
          const userResult = await client.query(userQuery, [req.user.id]);
          
          if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
          }

          const walletAmount = userResult.rows[0].wallet_amount || 0;
          const amountInCents = Math.round(amount * 100);

          // Check if wallet has enough funds
          if (walletAmount < amountInCents) {
            return res.status(400).json({
              error: 'Insufficient funds in wallet',
              required: amountInCents / 100,
              available: walletAmount / 100
            });
          }

          // Deduct amount from wallet
          const newWalletAmount = walletAmount - amountInCents;
          await client.query(
            'UPDATE users SET wallet_amount = $1 WHERE id = $2',
            [newWalletAmount, req.user.id]
          );

          // Add amount to tasker's wallet
          const taskerQuery = 'SELECT wallet_amount FROM users WHERE id = $1';
          const taskerResult = await client.query(taskerQuery, [taskRequest.tasker_id]);
          const taskerWalletAmount = taskerResult.rows[0].wallet_amount || 0;
          const newTaskerWalletAmount = taskerWalletAmount + amountInCents;
          await client.query(
            'UPDATE users SET wallet_amount = $1 WHERE id = $2',
            [newTaskerWalletAmount, taskRequest.tasker_id]
          );

          // Create a unique session ID for wallet payment
          const sessionIdSender = `wallet_payment_sender_${req.user.id}_${task_id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const sessionIdTasker = `wallet_payment_tasker_${req.user.id}_${task_id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // Create payment record for sender (payment)
          await Payment.createPayment({
            task_request_id: task_id,
            amount: amount * -1,
            currency: 'EUR',
            stripe_session_id: sessionIdSender,
            stripe_payment_intent_id: null,
            status: 'completed',
            user_id: req.user.id,
            is_payment: true
          });

          // Create payment record for tasker (earning)
          await Payment.createPayment({
            task_request_id: task_id,
            amount: amount,
            currency: 'EUR',
            stripe_session_id: sessionIdTasker,
            stripe_payment_intent_id: null,
            status: 'completed',
            user_id: taskRequest.tasker_id,
            is_payment: false
          });

          // Update task status to paid
          await TaskRequest.updateStatus(task_id, 'paid');

          await client.query('COMMIT');

          return res.json({
            success: true,
            message: 'Payment completed successfully using wallet',
            remaining_balance: newWalletAmount / 100
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }

      // Handle card payment (existing Stripe flow)
      const baseUrl = 'http://192.168.56.1:3001';
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: {
                name: 'Task Payment',
                description: `Payment for task #${task_id}`,
              },
              unit_amount: Math.round(amount * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        metadata: {
          task_id: task_id.toString(),
          amount: amount.toString(),
          sender_id: req.user.id.toString(),
          tasker_id: taskRequest.tasker_id.toString(),
          session_prefix: `payer_${req.user.id}_${task_id}`
        },
        mode: 'payment',
        success_url: `${baseUrl}/api/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/api/payment/cancel?task_id=${task_id}`,
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({
        error: 'Failed to create checkout session',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // Handle success redirect
  async handleSuccess(req, res) {
    const { session_id } = req.query;
    try {
      // Verify the session and get task_id from metadata
      const session = await stripe.checkout.sessions.retrieve(session_id);
      const task_id = session.metadata.task_id;
      
      console.log('Success redirect for session:', session_id, 'task_id:', task_id);

      // Read and modify the success HTML template
      let htmlContent = fs.readFileSync(path.join(__dirname, '../views/payment-success.html'), 'utf8');
      
      // Replace the placeholder with actual task_id
      htmlContent = htmlContent.replace('TASK_ID_PLACEHOLDER', task_id);

      // Send the modified HTML
      res.send(htmlContent);
    } catch (error) {
      console.error('Error handling success redirect:', error);
      res.redirect('sharingapp://payment-error');
    }
  },

  // Handle cancel redirect
  async handleCancel(req, res) {
    const { task_id } = req.query;
    console.log('Payment cancelled by user for task:', task_id);

    // Update payment status to canceled
    const payment = await Payment.getByTaskRequestId(task_id);
    if (payment) {
      await Payment.updateStatusToCanceled(task_id);
    }

    // Read the cancel HTML template
    let htmlContent = fs.readFileSync(path.join(__dirname, '../views/payment-cancel.html'), 'utf8');
    
    // Replace the placeholder with actual task_id
    htmlContent = htmlContent.replace('TASK_ID_PLACEHOLDER', task_id);

    // Send the HTML
    res.send(htmlContent);
  },

  // Handle Stripe webhooks
  async handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const taskId = session.metadata.task_id;
          const senderId = session.metadata.sender_id;
          const taskerId = session.metadata.tasker_id;
          const amount = parseFloat(session.metadata.amount);
          const sessionPrefix = session.metadata.session_prefix;
          const amountInCents = Math.round(amount * 100);

          console.log('=== Checkout Session Completed ===');
          console.log('Session ID:', session.id);
          console.log('Payment Status:', session.payment_status);
          console.log('==============================');

          // Add amount to tasker's wallet
          const taskerQuery = 'SELECT wallet_amount FROM users WHERE id = $1';
          const taskerResult = await pool.query(taskerQuery, [taskerId]);
          const taskerWalletAmount = taskerResult.rows[0].wallet_amount || 0;
          const newTaskerWalletAmount = taskerWalletAmount + amountInCents;
          await pool.query(
            'UPDATE users SET wallet_amount = $1 WHERE id = $2',
            [newTaskerWalletAmount, taskerId]
          );

          // Create payment record for sender (payment)
          await Payment.createPayment({
            task_request_id: taskId,
            amount: amount * -1, // Negative amount for sender
            currency: 'EUR',
            stripe_session_id: `${sessionPrefix}_sender_${session.id}`,
            stripe_payment_intent_id: session.payment_intent,
            status: 'completed',
            user_id: senderId,
            is_payment: true
          });

          // Create payment record for tasker (earning)
          await Payment.createPayment({
            task_request_id: taskId,
            amount: amount, // Positive amount for tasker
            currency: 'EUR',
            stripe_session_id: `${sessionPrefix}_tasker_${session.id}`,
            stripe_payment_intent_id: session.payment_intent,
            status: 'completed',
            user_id: taskerId,
            is_payment: false
          });

          // Update task status to paid
          await TaskRequest.updateStatus(taskId, 'paid');
          console.log(`Payment completed and status updated for task ${taskId}`);

          break;
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({
        error: 'Failed to process webhook',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

module.exports = paymentController; 