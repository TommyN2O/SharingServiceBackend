const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class CustomerRequest extends BaseModel {
  constructor() {
    super('customer_requests');
  }

  async findByUserId(userId) {
    const query = `
      SELECT cr.*, u.name, u.surname
      FROM customer_requests cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.user_id = $1
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  async findRequestsByCategory(categoryId) {
    const query = `
      SELECT cr.*, u.name, u.surname
      FROM customer_requests cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.category_id = $1
      ORDER BY cr.created_at DESC
    `;
    const { rows } = await pool.query(query, [categoryId]);
    return rows;
  }

  async findRequestsByCity(city) {
    const query = `
      SELECT cr.*, u.name, u.surname
      FROM customer_requests cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.city = $1
      ORDER BY cr.created_at DESC
    `;
    const { rows } = await pool.query(query, [city]);
    return rows;
  }

  async getRequestWithOffers(requestId) {
    const query = `
      SELECT cr.*, u.name, u.surname,
             cro.*, tu.name as tasker_name, tu.surname as tasker_surname
      FROM customer_requests cr
      JOIN users u ON cr.user_id = u.id
      LEFT JOIN customer_request_offers cro ON cr.id = cro.request_id
      LEFT JOIN users tu ON cro.tasker_id = tu.id
      WHERE cr.id = $1
    `;
    const { rows } = await pool.query(query, [requestId]);
    return rows;
  }
}

module.exports = new CustomerRequest(); 