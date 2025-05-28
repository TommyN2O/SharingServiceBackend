const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class Payment extends BaseModel {
  constructor() {
    super('payments');
    this.initialize();
  }

  // Initialize payments table
  async initialize() {
    try {
      await this.createPaymentsTable();
      await this.addStatusColumn();
      await this.addUserIdColumn();
      await this.addIsPaymentColumn();
      console.log('Payments table initialized successfully');
    } catch (error) {
      console.error('Error initializing payments table:', error);
      throw error;
    }
  }

  // Create payments table
  async createPaymentsTable() {
    try {
      const query = `
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
          amount DECIMAL(10,2) NOT NULL,
          currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
          stripe_session_id VARCHAR(255) NOT NULL UNIQUE,
          stripe_payment_intent_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await pool.query(query);
    } catch (error) {
      console.error('Error creating payments table:', error);
      throw error;
    }
  }

  // Add status column if it doesn't exist
  async addStatusColumn() {
    try {
      const query = `
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'payments' 
            AND column_name = 'status'
          ) THEN 
            ALTER TABLE payments 
            ADD COLUMN status VARCHAR(50) DEFAULT 'waiting';
          END IF;
        END $$;
      `;
      await pool.query(query);
    } catch (error) {
      console.error('Error adding status column:', error);
      throw error;
    }
  }

  // Add user_id column if it doesn't exist
  async addUserIdColumn() {
    try {
      const query = `
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'payments' 
            AND column_name = 'user_id'
          ) THEN 
            ALTER TABLE payments 
            ADD COLUMN user_id INTEGER REFERENCES users(id);
          END IF;
        END $$;
      `;
      await pool.query(query);
    } catch (error) {
      console.error('Error adding user_id column:', error);
      throw error;
    }
  }

  // Add is_payment column if it doesn't exist
  async addIsPaymentColumn() {
    try {
      const query = `
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'payments' 
            AND column_name = 'is_payment'
          ) THEN 
            ALTER TABLE payments 
            ADD COLUMN is_payment BOOLEAN DEFAULT true;
          END IF;
        END $$;
      `;
      await pool.query(query);
    } catch (error) {
      console.error('Error adding is_payment column:', error);
      throw error;
    }
  }

  // Create a new payment record
  async createPayment(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Parse task_request_id and amount if they're strings
      const taskRequestId = parseInt(data.task_request_id);
      const amount = parseFloat(data.amount);

      if (isNaN(taskRequestId) || isNaN(amount)) {
        throw new Error('Invalid task_request_id or amount');
      }

      // Check if payment already exists
      const existingPaymentQuery = `
        SELECT id FROM payments 
        WHERE task_request_id = $1 
        AND stripe_session_id LIKE $2
      `;
      const existingPayment = await client.query(existingPaymentQuery, [
        taskRequestId,
        `%${data.stripe_session_id}%`
      ]);

      if (existingPayment.rows.length > 0) {
        await client.query('COMMIT');
        return { success: true, message: 'Payment already processed' };
      }

      // Get task request details to get sender and tasker IDs
      const taskQuery = `
        SELECT sender_id, tasker_id, duration
        FROM task_requests
        WHERE id = $1
      `;
      const taskResult = await client.query(taskQuery, [taskRequestId]);
      
      if (!taskResult.rows.length) {
        throw new Error('Task request not found');
      }

      const { sender_id, tasker_id, duration } = taskResult.rows[0];
      const serviceFee = 2.50 * duration; // Service fee is 2.50 per hour
      const taskerAmount = Math.abs(amount) - serviceFee;

      // Create sender's payment record (on hold)
      const senderSessionId = `payer_${sender_id}_${taskRequestId}_sender_${data.stripe_session_id}`;
      const senderPaymentQuery = `
        INSERT INTO payments (
          task_request_id,
          user_id,
          amount,
          currency,
          stripe_session_id,
          stripe_payment_intent_id,
          status,
          is_payment
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING id
      `;
      await client.query(senderPaymentQuery, [
        taskRequestId,
        sender_id,
        Math.abs(amount)*-1,
        data.currency || 'EUR',
        senderSessionId,
        data.stripe_payment_intent_id,
        'on hold',
        true
      ]);

      // Create tasker's payment record (pending)
      const taskerSessionId = `tasker_${sender_id}_${taskRequestId}_tasker_${data.stripe_session_id}`;
      const taskerPaymentQuery = `
        INSERT INTO payments (
          task_request_id,
          user_id,
          amount,
          currency,
          stripe_session_id,
          stripe_payment_intent_id,
          status,
          is_payment
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING id
      `;
      await client.query(taskerPaymentQuery, [
        taskRequestId,
        tasker_id,
        taskerAmount,
        data.currency || 'EUR',
        taskerSessionId,
        data.stripe_payment_intent_id,
        'pending',
        false
      ]);

      await client.query('COMMIT');
      return { success: true, message: 'Payments created successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get payment by task request ID
  async getByTaskRequestId(taskRequestId) {
    const query = `
      SELECT * FROM payments
      WHERE task_request_id = $1
      AND is_payment = true
    `;
    const result = await pool.query(query, [taskRequestId]);
    return result.rows[0];
  }

  // Update payment status to completed
  async updateStatusToCompleted(taskRequestId) {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get task request details
        const taskQuery = `
          SELECT sender_id, tasker_id
          FROM task_requests
          WHERE id = $1
        `;
        const taskResult = await client.query(taskQuery, [taskRequestId]);
        
        if (!taskResult.rows.length) {
          throw new Error('Task request not found');
        }

        const { sender_id, tasker_id } = taskResult.rows[0];

        // Get tasker's payment record to find the amount
        const taskerPaymentQuery = `
          SELECT amount 
          FROM payments 
          WHERE task_request_id = $1 
          AND user_id = $2 
          AND is_payment = false
        `;
        const taskerPaymentResult = await client.query(taskerPaymentQuery, [taskRequestId, tasker_id]);

        if (!taskerPaymentResult.rows.length) {
          throw new Error('Tasker payment record not found');
        }

        const taskerAmount = taskerPaymentResult.rows[0].amount;

        // Update both payment records to completed
        await client.query(`
          UPDATE payments 
          SET status = 'completed' 
          WHERE task_request_id = $1 
          AND (user_id = $2 OR user_id = $3)
        `, [taskRequestId, sender_id, tasker_id]);

        // Add amount to tasker's wallet
        const amountInCents = Math.round(taskerAmount * 100);
        await client.query(`
          UPDATE users 
          SET wallet_amount = COALESCE(wallet_amount, 0) + $1 
          WHERE id = $2
        `, [amountInCents, tasker_id]);

        // Get sender's name for notification
        const senderQuery = `
          SELECT name, surname 
          FROM users 
          WHERE id = $1
        `;
        const senderResult = await client.query(senderQuery, [sender_id]);
        const sender = senderResult.rows[0];

        // Send notification to tasker about payment completion
        const FirebaseService = require('../services/firebaseService');
        await FirebaseService.sendTaskRequestNotification(
          sender_id,
          tasker_id,
          {
            id: taskRequestId.toString(),
            title: '💰 Gautas mokėjimas',
            description: `Mokėjimas nuo ${sender.name} ${sender.surname[0]}. pridėtas į jūsų skaitmeninę piniginę`,
          
            type: 'payment_completed'
          }
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error updating payment status:', error);
      throw error;
    }
  }

  // Update payment status to canceled
  async updateStatusToCanceled(taskRequestId) {
    const query = `
      UPDATE payments
      SET status = 'canceled'
      WHERE task_request_id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [taskRequestId]);
    return result.rows[0];
  }

  // Handle payment refund when task is canceled
  async handleTaskCancellation(taskId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get both payment records for this task
      const paymentsQuery = `
        SELECT p.*, u.wallet_amount, u.id as user_id
        FROM payments p
        JOIN users u ON p.user_id = u.id
        WHERE p.task_request_id = $1
        AND p.status NOT IN ('refunded', 'canceled')
      `;
      const paymentsResult = await client.query(paymentsQuery, [taskId]);
      
      console.log('Found payments for task:', taskId, paymentsResult.rows);

      if (paymentsResult.rows.length === 0) {
        console.log('No active payments found for task:', taskId);
        return { success: true, message: 'No active payments to refund' };
      }

      // Find sender's payment (is_payment = true) and tasker's payment (is_payment = false)
      const senderPayment = paymentsResult.rows.find(p => p.is_payment === true);
      const taskerPayment = paymentsResult.rows.find(p => p.is_payment === false);

      if (!senderPayment) {
        console.log('No sender payment found for task:', taskId);
        return { success: true, message: 'No sender payment to refund' };
      }

      console.log('Processing refund for task:', taskId);
      console.log('Sender payment:', senderPayment);
      console.log('Tasker payment:', taskerPayment);

      // Convert amount to cents for wallet operations
      const refundAmountInCents = Math.round(Math.abs(senderPayment.amount) * 100);

      // Update sender's wallet with refund
      const updateWalletQuery = `
        UPDATE users 
        SET wallet_amount = COALESCE(wallet_amount, 0) + $1 
        WHERE id = $2
        RETURNING wallet_amount
      `;
      const walletResult = await client.query(updateWalletQuery, [refundAmountInCents, senderPayment.user_id]);
      console.log('Updated sender wallet. New amount:', walletResult.rows[0].wallet_amount);

      // Update payment statuses
      const updateSenderPaymentQuery = `
        UPDATE payments 
        SET status = 'refunded'
        WHERE id = $1
        RETURNING id, status
      `;
      const senderUpdateResult = await client.query(updateSenderPaymentQuery, [senderPayment.id]);
      console.log('Updated sender payment status:', senderUpdateResult.rows[0]);

      if (taskerPayment) {
        const updateTaskerPaymentQuery = `
          UPDATE payments 
          SET status = 'canceled'
          WHERE id = $1
          RETURNING id, status
        `;
        const taskerUpdateResult = await client.query(updateTaskerPaymentQuery, [taskerPayment.id]);
        console.log('Updated tasker payment status:', taskerUpdateResult.rows[0]);
      }

      await client.query('COMMIT');
      return { success: true, message: 'Payment refunded successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error handling task cancellation:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new Payment();
