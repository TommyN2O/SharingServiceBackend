const pool = require('../config/db');

class BaseModel {
  constructor(tableName) {
    this.tableName = tableName;
  }

  async findAll() {
    const query = `SELECT * FROM ${this.tableName}`;
    const result = await pool.query(query);
    return result.rows;
  }

  async findById(id) {
    const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  async create(data) {
    const columns = Object.keys(data).join(', ');
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    const query = `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async update(id, data) {
    const setClause = Object.keys(data)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const values = [id, ...Object.values(data)];
    const query = `UPDATE ${this.tableName} SET ${setClause} WHERE id = $1 RETURNING *`;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async delete(id) {
    const query = `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING *`;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  async findByField(field, value) {
    const query = `SELECT * FROM ${this.tableName} WHERE ${field} = $1`;
    const { rows } = await pool.query(query, [value]);
    return rows;
  }

  async findOneByField(field, value) {
    const query = `SELECT * FROM ${this.tableName} WHERE ${field} = $1 LIMIT 1`;
    const { rows } = await pool.query(query, [value]);
    return rows[0];
  }
}

module.exports = BaseModel;
