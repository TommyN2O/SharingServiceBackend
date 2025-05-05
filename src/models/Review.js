const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class Review extends BaseModel {
  constructor() {
    super('reviews');
  }

  async findByTaskId(taskId) {
    const query = `
      SELECT r.*, 
             u.name as reviewer_name, u.surname as reviewer_surname
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.planned_task_id = $1
    `;
    const { rows } = await pool.query(query, [taskId]);
    return rows[0];
  }

  async findByRevieweeId(revieweeId) {
    const query = `
      SELECT r.*, 
             u.name as reviewer_name, u.surname as reviewer_surname
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.reviewee_id = $1
      ORDER BY r.created_at DESC
    `;
    const { rows } = await pool.query(query, [revieweeId]);
    return rows;
  }

  async createReview(data) {
    const {
      planned_task_id, reviewer_id, reviewee_id, rating, review,
    } = data;
    const query = `
      INSERT INTO reviews (planned_task_id, reviewer_id, reviewee_id, rating, review)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      planned_task_id,
      reviewer_id,
      reviewee_id,
      rating,
      review,
    ]);
    return rows[0];
  }

  async getTaskerAverageRating(taskerId) {
    const query = `
      SELECT AVG(rating) as average_rating, COUNT(*) as total_reviews
      FROM reviews
      WHERE reviewee_id = $1
    `;
    const { rows } = await pool.query(query, [taskerId]);
    return rows[0];
  }
}

module.exports = new Review();
