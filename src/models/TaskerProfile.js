const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class TaskerProfile extends BaseModel {
  constructor() {
    super('tasker_profiles');
  }

  async findByUserId(userId) {
    const query = 'SELECT * FROM tasker_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  async createOrUpdate(data) {
    const { user_id, ...profileData } = data;
    const existingProfile = await this.findByUserId(user_id);

    if (existingProfile) {
      return this.update(existingProfile.id, profileData);
    } else {
      return this.create({
        user_id,
        ...profileData
      });
    }
  }

  async getTopTaskers(limit = 10) {
    const query = `
      SELECT tp.*, u.name, u.surname, 
             COUNT(DISTINCT pt.id) as completed_tasks,
             AVG(r.rating) as average_rating
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN planned_tasks pt ON tp.user_id = pt.tasker_id AND pt.status = 'completed'
      LEFT JOIN reviews r ON pt.id = r.planned_task_id
      GROUP BY tp.id, u.name, u.surname
      ORDER BY average_rating DESC NULLS LAST, completed_tasks DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows;
  }

  async searchTaskers(category, location, minPrice, maxPrice) {
    const query = `
      SELECT tp.*, u.name, u.surname, 
             COUNT(DISTINCT pt.id) as completed_tasks,
             AVG(r.rating) as average_rating
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN planned_tasks pt ON tp.user_id = pt.tasker_id AND pt.status = 'completed'
      LEFT JOIN reviews r ON pt.id = r.planned_task_id
      WHERE ($1::text IS NULL OR tp.skills @> ARRAY[$1]::text[])
        AND ($2::text IS NULL OR tp.location ILIKE $2)
        AND ($3::numeric IS NULL OR tp.hourly_rate >= $3)
        AND ($4::numeric IS NULL OR tp.hourly_rate <= $4)
      GROUP BY tp.id, u.name, u.surname
      ORDER BY average_rating DESC NULLS LAST, completed_tasks DESC
    `;
    const result = await pool.query(query, [category, location, minPrice, maxPrice]);
    return result.rows;
  }

  async findAvailableTaskers(city, categoryId) {
    const query = `
      SELECT tp.*, u.name, u.surname
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      WHERE $1 = ANY(tp.available_cities)
      AND $2 = ANY(tp.category_ids)
      AND tp.can_take_tasks = true
    `;
    const { rows } = await pool.query(query, [city, categoryId]);
    return rows;
  }

  async updateRating(taskerId, newRating) {
    const query = `
      UPDATE tasker_profiles
      SET rating = (
        (rating * review_count + $1) / (review_count + 1)
      ),
      review_count = review_count + 1
      WHERE user_id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [newRating, taskerId]);
    return rows[0];
  }

  async updateAvailability(userId, availableTime) {
    const query = `
      UPDATE tasker_profiles
      SET available_time = $1
      WHERE user_id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [availableTime, userId]);
    return rows[0];
  }
}

module.exports = new TaskerProfile(); 