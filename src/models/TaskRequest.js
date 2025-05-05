const BaseModel = require('./BaseModel');
const pool = require('../config/database');
const Payment = require('./Payment');
const User = require('./User');

class TaskRequest extends BaseModel {
  constructor() {
    super('task_requests');
    this.initialize();
  }

  async initialize() {
    try {
      await this.createTaskRequestsTable();
      await this.alterDurationColumn();
      console.log('Task requests table initialized successfully');
    } catch (error) {
      console.error('Error initializing task requests table:', error);
      throw error;
    }
  }

  async createTaskRequestsTable() {
    try {
      const query = `
        CREATE TABLE IF NOT EXISTS task_requests (
          id SERIAL PRIMARY KEY,
          description TEXT NOT NULL,
          city_id INTEGER REFERENCES cities(id),
          duration INTEGER NOT NULL,
          sender_id INTEGER REFERENCES users(id),
          tasker_id INTEGER REFERENCES users(id),
          status VARCHAR(50) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await pool.query(query);
    } catch (error) {
      console.error('Error creating task requests table:', error);
      throw error;
    }
  }

  async alterDurationColumn() {
    try {
      // Check if duration column exists
      const checkQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'task_requests' 
        AND column_name = 'duration'
      `;
      const result = await pool.query(checkQuery);

      if (result.rows.length === 0) {
        // Duration column doesn't exist, create it
        await pool.query(`
          ALTER TABLE task_requests 
          ADD COLUMN duration INTEGER NOT NULL DEFAULT 60
        `);
        console.log('Duration column added as INTEGER');
      } else {
        // Column exists, check if it's INTEGER
        const typeQuery = `
          SELECT data_type 
          FROM information_schema.columns 
          WHERE table_name = 'task_requests' 
          AND column_name = 'duration'
        `;
        const typeResult = await pool.query(typeQuery);

        if (typeResult.rows[0].data_type.toLowerCase() !== 'integer') {
          // Convert existing column to INTEGER
          await pool.query(`
            ALTER TABLE task_requests 
            ALTER COLUMN duration TYPE INTEGER 
            USING (
              CASE 
                WHEN duration ~ '^[0-9]+$' THEN duration::INTEGER
                WHEN duration ~ '([0-9]+).*' THEN (regexp_matches(duration, '([0-9]+)'))[1]::INTEGER
                ELSE 60
              END
            )
          `);
          console.log('Duration column converted to INTEGER');
        }
      }
    } catch (error) {
      console.error('Error managing duration column:', error);
      throw error;
    }
  }

  // Find task request by ID
  static async findById(taskId) {
    const query = `
      SELECT * FROM task_requests
      WHERE id = $1
    `;
    const result = await pool.query(query, [taskId]);
    return result.rows[0];
  }

  // Update task request status
  static async updateStatus(taskId, status) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateQuery = `
        UPDATE task_requests
        SET status = $1
        WHERE id = $2
        RETURNING *
      `;

      const result = await client.query(updateQuery, [status, taskId]);

      if (result.rows.length === 0) {
        throw new Error('Task request not found');
      }

      console.log('--------------------Task request status updated to:', status);
      // If task is completed, handle payment completion and wallet update
      if (status.toLowerCase() === 'completed') {
        // Get the payment record
        const payment = await Payment.getByTaskRequestId(taskId);
        if (!payment) {
          throw new Error('Payment record not found');
        }

        // Update payment status to completed
        await Payment.updateStatusToCompleted(taskId);

        // Get task request to find tasker_id
        const taskRequest = await this.findById(taskId);
        if (!taskRequest) {
          throw new Error('Task request not found');
        }

        // Update tasker's wallet
        const amountInCents = Math.round(payment.amount * 100);
        await User.updateWalletAmount(taskRequest.tasker_id, amountInCents);
        console.log(`Updated wallet for tasker ${taskRequest.tasker_id} with amount ${amountInCents} cents`);
      }

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new TaskRequest();
