const TaskRequest = require('../models/TaskRequest');
const Payment = require('../models/Payment');
const pool = require('../config/database');

// Update task request status
async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current task status
      const currentStatusQuery = 'SELECT status FROM task_requests WHERE id = $1';
      const currentStatusResult = await client.query(currentStatusQuery, [id]);

      if (!currentStatusResult.rows.length) {
        return res.status(404).json({ error: 'Task request not found' });
      }

      const currentStatus = currentStatusResult.rows[0].status;

      // If task is being canceled and was previously paid, handle payment refund
      if (status === 'Canceled' && currentStatus === 'paid') {
        try {
          await Payment.handleTaskCancellation(id);
          console.log(`Payment refunded for canceled task ${id}`);
        } catch (error) {
          console.error('Error handling payment refund:', error);
          await client.query('ROLLBACK');
          return res.status(500).json({ error: 'Failed to process payment refund' });
        }
      }

      // Update task status
      const updateQuery = 'UPDATE task_requests SET status = $1 WHERE id = $2 RETURNING *';
      const result = await client.query(updateQuery, [status, id]);

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating task request status:', error);
    res.status(500).json({ error: 'Failed to update task request status' });
  }
}

module.exports = {
  updateStatus,
};
