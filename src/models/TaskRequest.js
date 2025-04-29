const pool = require('../config/database');
const Payment = require('./Payment');
const User = require('./User');

class TaskRequest {
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

module.exports = TaskRequest; 