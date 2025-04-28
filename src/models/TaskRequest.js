const pool = require('../config/database');

class TaskRequest {
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