const stripe = require('../config/stripe');
const TaskRequest = require('../models/TaskRequest');
const path = require('path');
const fs = require('fs');

const paymentController = {
  // Create a checkout session
  async createCheckoutSession(req, res) {
    try {
      const { amount, task_id } = req.body;

      if (!amount || !task_id) {
        return res.status(400).json({
          error: 'Missing required parameters: amount and task_id are required'
        });
      }

      // Use standard HTTP URLs for Stripe but we'll redirect to app URLs later
      const baseUrl = 'http://192.168.56.1:3001';

      // Create Stripe checkout session
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

          console.log('=== Checkout Session Completed ===');
          console.log('Task ID:', taskId);
          console.log('Payment Status:', session.payment_status);
          console.log('Session ID:', session.id);
          console.log('==============================');

          // Update task status to 'paid'
          await TaskRequest.updateStatus(taskId, 'paid');
          console.log(`Payment completed and status updated for task ${taskId}`);
          break;
        }

        case 'checkout.session.expired': {
          const session = event.data.object;
          const taskId = session.metadata.task_id;

          // Update task status back to 'pending'
          await TaskRequest.updateStatus(taskId, 'pending');
          console.log(`Payment expired for task ${taskId}`);
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