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
    const query = `
      INSERT INTO payments (
        task_request_id,
        amount,
        currency,
        stripe_session_id,
        stripe_payment_intent_id,
        status,
        user_id,
        is_payment
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      data.task_request_id,
      data.amount,
      data.currency || 'EUR',
      data.stripe_session_id,
      data.stripe_payment_intent_id,
      data.status || 'waiting',
      data.user_id,
      data.is_payment
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
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
    const query = `
      UPDATE payments
      SET status = 'completed'
      WHERE task_request_id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [taskRequestId]);
    return result.rows[0];
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
}

module.exports = new Payment(); 