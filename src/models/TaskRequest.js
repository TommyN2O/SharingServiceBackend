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
      // First create the table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS task_requests (
          id SERIAL PRIMARY KEY,
          description TEXT NOT NULL,
          city_id INTEGER REFERENCES cities(id),
          duration INTEGER NOT NULL,
          sender_id INTEGER REFERENCES users(id),
          tasker_id INTEGER REFERENCES users(id),
          hourly_rate DECIMAL(10,2) NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          is_open_task BOOLEAN DEFAULT false,
          open_task_id INTEGER REFERENCES open_tasks(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await pool.query(createTableQuery);

      // Check if hourly_rate column exists
      const checkHourlyRateQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'task_requests' 
        AND column_name = 'hourly_rate'
      `;
      const hourlyRateResult = await pool.query(checkHourlyRateQuery);

      // Add hourly_rate column if it doesn't exist
      if (hourlyRateResult.rows.length === 0) {
        const alterHourlyRateQuery = `
          ALTER TABLE task_requests 
          ADD COLUMN hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0
        `;
        await pool.query(alterHourlyRateQuery);
        console.log('Added hourly_rate column to task_requests table');
      }

      // Check if is_open_task column exists
      const checkOpenTaskQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'task_requests' 
        AND column_name = 'is_open_task'
      `;
      const openTaskResult = await pool.query(checkOpenTaskQuery);

      // Add is_open_task column if it doesn't exist
      if (openTaskResult.rows.length === 0) {
        const alterOpenTaskQuery = `
          ALTER TABLE task_requests 
          ADD COLUMN is_open_task BOOLEAN DEFAULT false
        `;
        await pool.query(alterOpenTaskQuery);
        console.log('Added is_open_task column to task_requests table');
      }

      // Check if open_task_id column exists
      const checkOpenTaskIdQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'task_requests' 
        AND column_name = 'open_task_id'
      `;
      const openTaskIdResult = await pool.query(checkOpenTaskIdQuery);

      // Add open_task_id column if it doesn't exist
      if (openTaskIdResult.rows.length === 0) {
        const alterOpenTaskIdQuery = `
          ALTER TABLE task_requests 
          ADD COLUMN open_task_id INTEGER REFERENCES open_tasks(id)
        `;
        await pool.query(alterOpenTaskIdQuery);
        console.log('Added open_task_id column to task_requests table');
      }
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
          throw new Error('Mokėjimo įrašas nerastas');
        }

        // Update payment status to completed
        await Payment.updateStatusToCompleted(taskId);

        // Delete offers if this was from an open task
        await TaskRequest.deleteOffersForCompletedTask(taskId);
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

  // Delete offers for a completed task that originated from an open task
  static async deleteOffersForCompletedTask(taskRequestId) {
    const client = await pool.connect();
    try {
      // Check if the task request was from an open task
      const taskQuery = `
        SELECT open_task_id, is_open_task
        FROM task_requests
        WHERE id = $1 AND is_open_task = true
      `;
      const taskResult = await client.query(taskQuery, [taskRequestId]);
      
      // If this was from an open task, delete all offers for that open task
      if (taskResult.rows.length > 0 && taskResult.rows[0].open_task_id) {
        const openTaskId = taskResult.rows[0].open_task_id;
        await client.query('DELETE FROM open_task_offers WHERE task_id = $1', [openTaskId]);
        console.log(`Ištrinti visi pasiūlymai užbaigtam atviram užsakymui ${openTaskId}`);
      }
    } catch (error) {
      console.error('Klaida trinant pasiūlymus užbaigtam užsakymui:', error);
      throw error;
    }
  }
}

module.exports = new TaskRequest();
