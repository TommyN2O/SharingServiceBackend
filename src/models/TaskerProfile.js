const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class TaskerProfile extends BaseModel {
  constructor() {
    super('tasker_profiles');
  }

  // Create tasker profile
  async create(data) {
    const { user_id, profile_photo, description, hourly_rate } = data;
    const query = `
      INSERT INTO tasker_profiles (user_id, profile_photo, description, hourly_rate)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await pool.query(query, [user_id, profile_photo, description, hourly_rate]);
    return result.rows[0];
  }

  // Add category to tasker profile
  async addCategory(tasker_id, category) {
    // Handle both object format {id, name} and direct ID
    const categoryId = typeof category === 'object' ? category.id : category;
    
    const query = `
      INSERT INTO tasker_categories (tasker_id, category_id)
      VALUES ($1, $2)
      ON CONFLICT (tasker_id, category_id) DO NOTHING
    `;
    await pool.query(query, [tasker_id, categoryId]);
  }

  // Add city to tasker profile
  async addCity(tasker_id, city) {
    try {
      // Get the city ID from the object
      const cityId = typeof city === 'object' ? city.id : city;
      
      // Link the tasker to the city
      const query = `
        INSERT INTO tasker_cities (tasker_id, city_id)
        VALUES ($1, $2)
        ON CONFLICT (tasker_id, city_id) DO NOTHING
      `;
      await pool.query(query, [tasker_id, cityId]);
    } catch (error) {
      console.error('Error in addCity:', error);
      throw error;
    }
  }

  // Add availability slot
  async addAvailability(tasker_id, date, time) {
    const query = `
      INSERT INTO tasker_availability (tasker_id, date, time_slot)
      VALUES ($1, $2, $3)
      ON CONFLICT (tasker_id, date, time_slot) DO NOTHING
    `;
    await pool.query(query, [tasker_id, date, time]);
  }

  // Get complete profile with all details
  async getCompleteProfile(user_id) {
    const query = `
      SELECT 
        tp.id,
        CASE 
          WHEN tp.profile_photo LIKE 'http%' THEN CONCAT('images/', SPLIT_PART(tp.profile_photo, '/images/', 2))
          ELSE tp.profile_photo
        END as profile_photo,
        tp.description,
        tp.hourly_rate,
        COALESCE(AVG(r.rating), 0) as rating,
        COUNT(DISTINCT r.id) as review_count,
        u.name,
        u.surname,
        u.email,
        COALESCE(array_remove(array_agg(DISTINCT jsonb_build_object('id', tc.category_id, 'name', c.name)), NULL), '{}') as categories,
        COALESCE(array_remove(array_agg(DISTINCT jsonb_build_object('id', ci.id, 'name', ci.name)), NULL), '{}') as cities,
        COALESCE(array_remove(array_agg(DISTINCT ta.date || ' ' || ta.time_slot), NULL), '{}') as availability,
        COALESCE(array_remove(array_agg(DISTINCT tg.image_url), NULL), '{}') as gallery
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN tasker_categories tc ON tp.id = tc.tasker_id
      LEFT JOIN categories c ON tc.category_id = c.id
      LEFT JOIN tasker_cities tci ON tp.id = tci.tasker_id
      LEFT JOIN cities ci ON tci.city_id = ci.id
      LEFT JOIN tasker_availability ta ON tp.id = ta.tasker_id
      LEFT JOIN tasker_gallery tg ON tp.id = tg.tasker_id
      LEFT JOIN planned_tasks pt ON tp.user_id = pt.tasker_id
      LEFT JOIN reviews r ON pt.id = r.planned_task_id
      WHERE tp.user_id = $1
      GROUP BY tp.id, u.id, u.name, u.surname, u.email
    `;
    const result = await pool.query(query, [user_id]);
    return result.rows[0];
  }

  // Find profile by user ID
  async findByUserId(user_id) {
    const query = `
      SELECT * FROM tasker_profiles WHERE user_id = $1
    `;
    const result = await pool.query(query, [user_id]);
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

  async updateRating(tasker_id, new_rating) {
    const query = `
      UPDATE tasker_profiles
      SET rating = (
        (rating * review_count + $1) / (review_count + 1)
      ),
      review_count = review_count + 1
      WHERE id = $2
      RETURNING rating, review_count
    `;
    const result = await pool.query(query, [new_rating, tasker_id]);
    return result.rows[0];
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

  // Delete tasker profile and all related data
  async delete(user_id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete related data first (due to foreign key constraints)
      await client.query('DELETE FROM tasker_gallery WHERE tasker_id IN (SELECT id FROM tasker_profiles WHERE user_id = $1)', [user_id]);
      await client.query('DELETE FROM tasker_availability WHERE tasker_id IN (SELECT id FROM tasker_profiles WHERE user_id = $1)', [user_id]);
      await client.query('DELETE FROM tasker_cities WHERE tasker_id IN (SELECT id FROM tasker_profiles WHERE user_id = $1)', [user_id]);
      await client.query('DELETE FROM tasker_categories WHERE tasker_id IN (SELECT id FROM tasker_profiles WHERE user_id = $1)', [user_id]);
      
      // Delete the tasker profile
      const result = await client.query('DELETE FROM tasker_profiles WHERE user_id = $1 RETURNING *', [user_id]);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Add photo to gallery
  async addGalleryPhoto(tasker_id, image_path, description = null) {
    const query = `
      INSERT INTO tasker_gallery (tasker_id, image_path, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [tasker_id, image_path, description]);
    return result.rows[0];
  }

  // Remove photo from gallery
  async removeGalleryPhoto(tasker_id, photo_id) {
    const query = `
      DELETE FROM tasker_gallery
      WHERE tasker_id = $1 AND id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [tasker_id, photo_id]);
    return result.rows[0];
  }

  // Get gallery photos
  async getGalleryPhotos(tasker_id) {
    const query = `
      SELECT * FROM tasker_gallery
      WHERE tasker_id = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [tasker_id]);
    return result.rows;
  }

  // Get rating and review count
  async getRating(tasker_id) {
    const query = `
      SELECT rating, review_count
      FROM tasker_profiles
      WHERE id = $1
    `;
    const result = await pool.query(query, [tasker_id]);
    return result.rows[0];
  }
}

module.exports = new TaskerProfile(); 