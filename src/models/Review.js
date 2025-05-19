const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class Review extends BaseModel {
  constructor() {
    super('reviews');
  }

  async findByTaskRequestId(taskRequestId) {
    const query = `
      SELECT r.*, 
             u.name as reviewer_name, u.surname as reviewer_surname
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.task_request_id = $1
    `;
    const { rows } = await pool.query(query, [taskRequestId]);
    return rows[0];
  }

  async findByRevieweeId(revieweeId) {
    console.log('Finding reviews for reviewee ID:', revieweeId);
    
    // First, let's check if we need to get the user_id from tasker_profiles
    const taskerQuery = `
      SELECT user_id 
      FROM tasker_profiles 
      WHERE id = $1
    `;
    const taskerResult = await pool.query(taskerQuery, [revieweeId]);
    const userId = taskerResult.rows[0]?.user_id;
    
    console.log('Found user_id:', userId);

    const query = `
      SELECT 
        r.id,
        r.rating,
        r.review,
        to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        json_build_object(
          'id', u.id,
          'name', u.name,
          'surname', u.surname,
          'profile_photo', CASE 
            WHEN u.profile_photo IS NULL THEN NULL
            WHEN u.profile_photo LIKE 'http%' THEN u.profile_photo
            WHEN u.profile_photo LIKE 'images/%' THEN u.profile_photo
            ELSE CONCAT('images/', u.profile_photo)
          END
        ) as reviewer
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      JOIN task_requests tr ON r.task_request_id = tr.id
      WHERE r.reviewee_id = $1
      ORDER BY r.created_at DESC
    `;
    const { rows } = await pool.query(query, [userId || revieweeId]);
    console.log('Found reviews:', rows.length);
    return rows;
  }

  async createReview(data) {
    const {
      task_request_id, reviewer_id, reviewee_id, rating, review,
    } = data;
    const query = `
      INSERT INTO reviews (task_request_id, reviewer_id, reviewee_id, rating, review)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      task_request_id,
      reviewer_id,
      reviewee_id,
      rating,
      review,
    ]);
    return rows[0];
  }

  async getTaskerAverageRating(taskerId) {
    const query = `
      SELECT 
        AVG(rating) as average_rating, 
        COUNT(*) as total_reviews,
        json_agg(json_build_object(
          'rating', rating,
          'review', review,
          'created_at', created_at,
          'reviewer_name', u.name,
          'reviewer_surname', u.surname,
          'task_description', tr.description
        )) as recent_reviews
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      JOIN task_requests tr ON r.task_request_id = tr.id
      WHERE r.reviewee_id = $1
      GROUP BY r.reviewee_id
    `;
    const { rows } = await pool.query(query, [taskerId]);
    return rows[0] || { average_rating: 0, total_reviews: 0, recent_reviews: [] };
  }

  async checkReviewExists(taskRequestId) {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM reviews 
        WHERE task_request_id = $1
      ) as exists
    `;
    const { rows } = await pool.query(query, [taskRequestId]);
    return rows[0].exists;
  }

  async getReviewStatus(taskRequestId) {
    const query = `
      SELECT 
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM reviews 
            WHERE task_request_id = $1
          ) THEN true
          ELSE false
        END as has_review
    `;
    const { rows } = await pool.query(query, [taskRequestId]);
    return { hasReview: rows[0].has_review };
  }
}

module.exports = new Review();
