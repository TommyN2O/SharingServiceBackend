const path = require('path');
const fs = require('fs');
const stripe = require('../config/stripe');
const pool = require('../config/database');
const Payment = require('../models/Payment');
const TaskRequest = require('../models/TaskRequest');
const _User = require('../models/User');

const paymentController = {
  // Create a checkout session
  async createCheckoutSession(req, res) {
    try {
      const { amount, task_id, type } = req.body;

      if (!amount || !task_id || !type) {
        return res.status(400).json({
          error: 'Missing required parameters: amount, task_id, and type are required',
        });
      }

      if (!['Card', 'Wallet'].includes(type)) {
        return res.status(400).json({
          error: 'Invalid payment type. Must be either "Card" or "Wallet"',
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
              available: walletAmount / 100,
            });
          }

          // Deduct amount from wallet
          const newWalletAmount = walletAmount - amountInCents;
          await client.query(
            'UPDATE users SET wallet_amount = $1 WHERE id = $2',
            [newWalletAmount, req.user.id],
          );

          // Add amount to tasker's wallet
          const taskerQuery = 'SELECT wallet_amount FROM users WHERE id = $1';
          const taskerResult = await client.query(taskerQuery, [taskRequest.tasker_id]);
          const taskerWalletAmount = taskerResult.rows[0].wallet_amount || 0;
          const newTaskerWalletAmount = taskerWalletAmount + amountInCents;
          await client.query(
            'UPDATE users SET wallet_amount = $1 WHERE id = $2',
            [newTaskerWalletAmount, taskRequest.tasker_id],
          );

          // Create a unique session ID for wallet payment
          const sessionId = `wallet_payment_${req.user.id}_${task_id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // Create payment records (this will create both sender and tasker records)
          await Payment.createPayment({
            task_request_id: task_id,
            amount: amount,
            currency: 'EUR',
            stripe_session_id: sessionId,
            stripe_payment_intent_id: null,
            status: 'completed',
            user_id: req.user.id,
            is_payment: true,
          });

          // Update task status to paid
          await client.query(
            'UPDATE task_requests SET status = $1 WHERE id = $2',
            ['paid', task_id]
          );

          // Get sender's name for notification
          const senderQuery = `
            SELECT name, surname 
            FROM users 
            WHERE id = $1
          `;
          const senderResult = await client.query(senderQuery, [req.user.id]);
          const sender = senderResult.rows[0];

          // Send notification to tasker
          const FirebaseService = require('../services/firebaseService');
          await FirebaseService.sendTaskRequestNotification(
            req.user.id,
            taskRequest.tasker_id,
            {
              id: task_id.toString(),
              title: `📋 Task request from ${sender.name} ${sender.surname[0]}.`,
              description: `Task has been added to planned tasks`,
              type: 'status_update'
            }
          );

          await client.query('COMMIT');

          return res.json({
            success: true,
            message: 'Payment completed successfully using wallet',
            remaining_balance: newWalletAmount / 100,
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }

      // Handle card payment (existing Stripe flow)
      const baseUrl = 'http://10.0.2.2:3001';
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
          session_prefix: `payer_${req.user.id}_${task_id}`,
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
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Handle success redirect
  async handleSuccess(req, res) {
    const { session_id } = req.query;
    
    if (!session_id) {
      console.error('No session_id provided in success redirect');
      return res.redirect('sharingapp://payment-error');
    }

    try {
      // Verify the session and get task_id from metadata
      const session = await stripe.checkout.sessions.retrieve(session_id);
      
      if (!session || session.status !== 'complete') {
        console.error('Invalid or incomplete session:', session_id);
        return res.redirect('sharingapp://payment-error');
      }

      const { task_id } = session.metadata;
      console.log('Success redirect for session:', session_id, 'task_id:', task_id);

      // Read and modify the success HTML template
      let htmlContent = fs.readFileSync(path.join(__dirname, '../views/payment-success.html'), 'utf8');

      // Replace the placeholder with actual task_id
      htmlContent = htmlContent.replace('TASK_ID_PLACEHOLDER', task_id);

      // Add auto-redirect script
      const redirectScript = `
        <script type="text/javascript">
          window.onload = function() {
            // Try to open the app with success parameters
            window.location.href = 'sharingapp://payment-success?task_id=${task_id}';
            
            // Fallback - redirect to error after 3 seconds if app doesn't open
            setTimeout(function() {
              window.location.href = 'sharingapp://payment-error';
            }, 3000);
          }
        </script>
      `;

      // Insert the script before the closing </body> tag
      htmlContent = htmlContent.replace('</body>', `${redirectScript}</body>`);

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
    
    if (!task_id) {
      console.error('No task_id provided in cancel redirect');
      return res.redirect('sharingapp://payment-error');
    }

    console.log('Payment cancelled by user for task:', task_id);

    try {
      // Update payment status to canceled if it exists
      const payment = await Payment.getByTaskRequestId(task_id);
      if (payment) {
        await Payment.updateStatusToCanceled(task_id);
      }

      // Read the cancel HTML template
      let htmlContent = fs.readFileSync(path.join(__dirname, '../views/payment-cancel.html'), 'utf8');

      // Replace the placeholder with actual task_id
      htmlContent = htmlContent.replace('TASK_ID_PLACEHOLDER', task_id);

      // Add auto-redirect script
      const redirectScript = `
        <script type="text/javascript">
          window.onload = function() {
            // Try to open the app with cancel parameters
            window.location.href = 'sharingapp://payment-cancel?task_id=${task_id}';
            
            // Fallback - redirect to error after 3 seconds if app doesn't open
            setTimeout(function() {
              window.location.href = 'sharingapp://payment-error';
            }, 3000);
          }
        </script>
      `;

      // Insert the script before the closing </body> tag
      htmlContent = htmlContent.replace('</body>', `${redirectScript}</body>`);

      // Send the HTML
      res.send(htmlContent);
    } catch (error) {
      console.error('Error handling cancel redirect:', error);
      res.redirect('sharingapp://payment-error');
    }
  },

  // Handle Stripe webhooks
  async handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];

    if (!sig) {
      console.error('No Stripe signature found in webhook request');
      return res.status(400).send('No Stripe signature found');
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error('STRIPE_WEBHOOK_SECRET is not configured');
      return res.status(500).send('Webhook secret is not configured');
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      console.error('Headers:', req.headers);
      console.error('Body:', typeof req.body, req.body instanceof Buffer ? 'Buffer' : 'Not Buffer');
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
          console.log('Task ID:', taskId);
          console.log('Sender ID:', senderId);
          console.log('Tasker ID:', taskerId);
          console.log('Amount:', amount);
          console.log('=======================');

          // Get task details for service fee calculation
          const taskQuery = `
            SELECT duration 
            FROM task_requests 
            WHERE id = $1
          `;
          const taskResult = await pool.query(taskQuery, [taskId]);
          const duration = taskResult.rows[0].duration;
          const serviceFee = 2.50 * duration;

          console.log('Payment Breakdown:');
          console.log('Total Amount:', amount);
          console.log('Duration:', duration, 'hours');
          console.log('Service Fee:', serviceFee);
          console.log('Tasker Earnings:', amount - serviceFee);

          try {
            // Create payment records
            const paymentData = {
              task_request_id: taskId,
              amount: amount,
              currency: 'EUR',
              stripe_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent,
            };

            const result = await Payment.createPayment(paymentData);
            console.log(result.message);
            
            // Only update task status if new payments were created
            if (result.message === 'Payments created successfully') {
              // Update task request status to 'paid'
              await pool.query(
                'UPDATE task_requests SET status = $1 WHERE id = $2',
                ['paid', taskId]
              );

              // Get sender's name for notification
              const senderQuery = `
                SELECT name, surname 
                FROM users 
                WHERE id = $1
              `;
              const senderResult = await pool.query(senderQuery, [senderId]);
              const sender = senderResult.rows[0];

              // Send notification to tasker
              const FirebaseService = require('../services/firebaseService');
              await FirebaseService.sendTaskRequestNotification(
                senderId,
                taskerId,
                {
                  id: taskId,
                  title: `📋 Suplanuotas darbas pas ${sender.name} ${sender.surname[0]}.`,
                  description: `Užklausa pridėta prie suplanuotų darbų`,
                  type: 'status_update'
                }
              );
            }
          } catch (error) {
            console.error('Error processing payment:', error);
            return res.status(500).json({ error: 'Failed to process payment' });
          }
          break;
        }
      }

      // Send success response after all processing is complete
      return res.json({ received: true });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({
        error: 'Failed to process webhook',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Handle task completion and release payment
  async handleTaskCompletion(taskId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the pending payment details
      const pendingPaymentQuery = `
        SELECT * FROM pending_payments
        WHERE task_request_id = $1
      `;
      const pendingPaymentResult = await client.query(pendingPaymentQuery, [taskId]);
      
      if (!pendingPaymentResult.rows.length) {
        throw new Error('No pending payment found for this task');
      }

      const pendingPayment = pendingPaymentResult.rows[0];
      const amountInCents = Math.round(pendingPayment.amount * 100);

      // Update sender's payment status to completed
      await client.query(`
        UPDATE payments 
        SET status = 'completed'
        WHERE task_request_id = $1 
        AND is_payment = true
      `, [taskId]);

      // Add amount to tasker's wallet
      const taskerQuery = 'SELECT wallet_amount FROM users WHERE id = $1';
      const taskerResult = await client.query(taskerQuery, [pendingPayment.tasker_id]);
      const taskerWalletAmount = taskerResult.rows[0].wallet_amount || 0;
      const newTaskerWalletAmount = taskerWalletAmount + amountInCents;
      
      await client.query(
        'UPDATE users SET wallet_amount = $1 WHERE id = $2',
        [newTaskerWalletAmount, pendingPayment.tasker_id],
      );

      // Create payment record for tasker
      await Payment.createPayment({
        task_request_id: taskId,
        amount: pendingPayment.amount,
        currency: 'EUR',
        stripe_session_id: pendingPayment.stripe_session_id,
        stripe_payment_intent_id: pendingPayment.stripe_payment_intent_id,
        status: 'completed',
        user_id: pendingPayment.tasker_id,
        is_payment: false,
      });

      // Remove the pending payment record
      await client.query('DELETE FROM pending_payments WHERE task_request_id = $1', [taskId]);

      await client.query('COMMIT');
      console.log(`Payment completed for task ${taskId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = paymentController;
