const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class PlannedTask extends BaseModel {
  constructor() {
    super('planned_tasks');
  }

  async findByTaskerId(taskerId) {
    const query = `
      SELECT pt.*, u.name as customer_name, u.surname as customer_surname
      FROM planned_tasks pt
      JOIN users u ON pt.customer_id = u.id
      WHERE pt.tasker_id = $1
      ORDER BY pt.date ASC
    `;
    const { rows } = await pool.query(query, [taskerId]);
    return rows;
  }

  async findByCustomerId(customerId) {
    const query = `
      SELECT pt.*, u.name as tasker_name, u.surname as tasker_surname
      FROM planned_tasks pt
      JOIN users u ON pt.tasker_id = u.id
      WHERE pt.customer_id = $1
      ORDER BY pt.date ASC
    `;
    const { rows } = await pool.query(query, [customerId]);
    return rows;
  }

  async updateStatus(taskId, status) {
    const query = `
      UPDATE planned_tasks
      SET status = $1
      WHERE id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [status, taskId]);
    return rows[0];
  }

  async acceptTask(taskId, isTasker) {
    const field = isTasker ? 'tasker_accepted' : 'customer_accepted';
    const query = `
      UPDATE planned_tasks
      SET ${field} = true
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query(query, [taskId]);
    return rows[0];
  }

  async getTaskWithDetails(taskId) {
    const query = `
      SELECT pt.*,
             cu.name as customer_name, cu.surname as customer_surname,
             tu.name as tasker_name, tu.surname as tasker_surname,
             cr.name as request_name, cr.description as request_description
      FROM planned_tasks pt
      JOIN users cu ON pt.customer_id = cu.id
      JOIN users tu ON pt.tasker_id = tu.id
      JOIN customer_requests cr ON pt.request_id = cr.id
      WHERE pt.id = $1
    `;
    const { rows } = await pool.query(query, [taskId]);
    return rows[0];
  }
}

module.exports = new PlannedTask(); 