const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class OpenTask extends BaseModel {
  constructor() {
    super('open_tasks');
    this.initialize();
  }

  async initialize() {
    try {
      // Create open_tasks table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS open_tasks (
          id SERIAL PRIMARY KEY,
          description TEXT NOT NULL,
          budget DECIMAL(10,2),
          duration INTEGER NOT NULL, -- in minutes
          location_id INTEGER REFERENCES cities(id),
          creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES categories(id),
          status VARCHAR(20) DEFAULT 'open', -- open, assigned, completed, cancelled
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create open_task_photos table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS open_task_photos (
          id SERIAL PRIMARY KEY,
          task_id INTEGER REFERENCES open_tasks(id) ON DELETE CASCADE,
          photo_url TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create open_task_dates table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS open_task_dates (
          id SERIAL PRIMARY KEY,
          task_id INTEGER REFERENCES open_tasks(id) ON DELETE CASCADE,
          date DATE NOT NULL,
          time TIME NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Rename task_offers table if it exists
      await pool.query(`
        DO $$ 
        BEGIN 
          IF EXISTS (
            SELECT 1 
            FROM information_schema.tables 
            WHERE table_name = 'task_offers'
          ) THEN 
            ALTER TABLE task_offers RENAME TO open_task_offers;
          END IF;
        END $$;
      `);

      // Create open_task_offers table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS open_task_offers (
          id SERIAL PRIMARY KEY,
          task_id INTEGER REFERENCES open_tasks(id) ON DELETE CASCADE,
          tasker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          description TEXT NOT NULL,
          hourly_rate DECIMAL(10,2) NOT NULL,
          duration INTEGER NOT NULL DEFAULT 1, -- in hours
          preferred_date DATE NOT NULL,
          preferred_time TIME NOT NULL,
          status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rejected
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log('OpenTask tables initialized successfully');
    } catch (error) {
      console.error('Error initializing OpenTask tables:', error);
      throw error;
    }
  }

  // Create a new open task
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const {
        description,
        budget,
        duration,
        location_id,
        creator_id,
        category_id,
        photos,
        dates // Array of {date, time} objects
      } = data;

      // Insert the open task
      const taskQuery = `
        INSERT INTO open_tasks (
          description, budget, duration, location_id, creator_id, category_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const taskResult = await client.query(taskQuery, [
        description, budget, duration, location_id, creator_id, category_id
      ]);
      const task = taskResult.rows[0];

      // Add photos
      if (Array.isArray(photos)) {
        for (const photoUrl of photos) {
          await client.query(
            'INSERT INTO open_task_photos (task_id, photo_url) VALUES ($1, $2)',
            [task.id, photoUrl]
          );
        }
      }

      // Add dates and times
      if (Array.isArray(dates)) {
        for (const { date, time } of dates) {
          await client.query(
            'INSERT INTO open_task_dates (task_id, date, time) VALUES ($1, $2, $3)',
            [task.id, date, time]
          );
        }
      }

      await client.query('COMMIT');
      return task;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get open task by ID with all details
  async getById(taskId) {
    const query = `
      SELECT 
        ot.*,
        c.id as category_id,
        c.name as category_name,
        (
          SELECT json_agg(DISTINCT photo_url)
          FROM open_task_photos
          WHERE task_id = ot.id
        ) as photos,
        json_agg(DISTINCT jsonb_build_object(
          'date', otd.date,
          'time', otd.time
        )) as availability,
        json_agg(DISTINCT jsonb_build_object(
          'id', oto.id,
          'tasker_id', oto.tasker_id,
          'description', oto.description,
          'hourly_rate', oto.hourly_rate,
          'duration', oto.duration,
          'preferred_date', oto.preferred_date,
          'preferred_time', oto.preferred_time,
          'status', oto.status,
          'created_at', oto.created_at
        )) as offers,
        ci.name as location_name,
        u.name as creator_name,
        u.surname as creator_surname
      FROM open_tasks ot
      LEFT JOIN categories c ON ot.category_id = c.id
      LEFT JOIN open_task_dates otd ON ot.id = otd.task_id
      LEFT JOIN open_task_offers oto ON ot.id = oto.task_id
      LEFT JOIN cities ci ON ot.location_id = ci.id
      LEFT JOIN users u ON ot.creator_id = u.id
      WHERE ot.id = $1
      GROUP BY ot.id, c.id, c.name, ci.name, u.name, u.surname
    `;
    const result = await pool.query(query, [taskId]);
    return result.rows[0];
  }

  // Get all open tasks with optional filters
  async getAll(filters = {}) {
    const {
      category,
      cityIds,
      date,
      minBudget,
      maxBudget,
      duration,
      excludeUserId,
      status = 'open'
    } = filters;

    let query = `
      SELECT 
        ot.id,
        ot.description,
        ot.budget,
        ot.duration,
        ot.status,
        ot.created_at,
        jsonb_build_object(
          'id', ci.id,
          'name', ci.name
        ) as city,
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'image_url', c.image_url
        ) as category,
        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'surname', u.surname,
          'profile_photo', u.profile_photo
        ) as creator,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'date', to_char(otd.date, 'YYYY-MM-DD'),
              'time', to_char(otd.time, 'HH24:MI:SS')
            )
          ) FILTER (WHERE otd.date IS NOT NULL),
          '[]'
        ) as availability,
        COALESCE(
          json_agg(
            DISTINCT regexp_replace(
              otp.photo_url,
              '^.*\\\\public\\\\|^.*public/',
              ''
            )
          ) FILTER (WHERE otp.photo_url IS NOT NULL),
          '[]'::json
        ) as gallery
      FROM open_tasks ot
      LEFT JOIN categories c ON ot.category_id = c.id
      LEFT JOIN open_task_photos otp ON ot.id = otp.task_id
      LEFT JOIN open_task_dates otd ON ot.id = otd.task_id
      LEFT JOIN cities ci ON ot.location_id = ci.id
      LEFT JOIN users u ON ot.creator_id = u.id
      WHERE ot.status = $1
    `;

    const params = [status];
    let paramCount = 1;

    // Exclude tasks created by the specified user
    if (excludeUserId) {
      paramCount++;
      query += ` AND ot.creator_id != $${paramCount}`;
      params.push(excludeUserId);
    }

    // Filter by category
    if (category) {
      paramCount++;
      query += ` AND ot.category_id = $${paramCount}`;
      params.push(category);
    }

    // Filter by cities using ANY
    if (cityIds && cityIds.length > 0) {
      paramCount++;
      query += ` AND ot.location_id = ANY($${paramCount})`;
      params.push(cityIds);
    }

    // Filter by date
    if (date) {
      paramCount++;
      query += ` AND EXISTS (
        SELECT 1 FROM open_task_dates otd2 
        WHERE otd2.task_id = ot.id 
        AND otd2.date = $${paramCount}::date
      )`;
      params.push(date);
    }

    // Filter by budget range
    if (minBudget !== undefined && minBudget !== null) {
      paramCount++;
      query += ` AND ot.budget >= $${paramCount}`;
      params.push(minBudget);
    }

    if (maxBudget !== undefined && maxBudget !== null) {
      paramCount++;
      query += ` AND ot.budget <= $${paramCount}`;
      params.push(maxBudget);
    }

    // Filter by duration
    if (duration) {
      paramCount++;
      query += ` AND ot.duration = $${paramCount}`;
      params.push(duration);
    }

    query += ` 
      GROUP BY ot.id, c.id, c.name, c.description, c.image_url, ci.id, ci.name, 
               u.id, u.name, u.surname, u.profile_photo
      ORDER BY ot.created_at DESC
    `;

    console.log('Final query:', query);
    console.log('Final parameters:', params);

    const result = await pool.query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      description: row.description,
      budget: row.budget,
      duration: row.duration,
      status: row.status,
      created_at: row.created_at,
      city: row.city,
      category: row.category,
      creator: row.creator,
      availability: Array.isArray(row.availability) ? row.availability : [],
      gallery: Array.isArray(row.gallery) ? 
        [...new Set(row.gallery.map(path => path.replace(/\\/g, '/')))] : []
    }));
  }

  // Create a new offer for a task
  async createOffer(data) {
    const {
      task_id,
      tasker_id,
      description,
      hourly_rate,
      duration,
      preferred_date,
      preferred_time
    } = data;

    const query = `
      INSERT INTO open_task_offers (
        task_id, tasker_id, description, hourly_rate,
        duration, preferred_date, preferred_time
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const result = await pool.query(query, [
      task_id,
      tasker_id,
      description,
      hourly_rate,
      duration,
      preferred_date,
      preferred_time
    ]);
    return result.rows[0];
  }

  // Accept an offer and convert to task request
  async acceptOffer(offerId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the offer details with task and tasker info
      const offerQuery = `
        SELECT 
          oto.id as offer_id,
          oto.description as offer_description,
          oto.hourly_rate,
          oto.duration as offer_duration,
          oto.preferred_date as offer_date,
          oto.preferred_time as offer_time,
          oto.tasker_id,
          ot.id as task_id,
          ot.creator_id,
          ot.location_id,
          ot.category_id,
          ot.description as task_description,
          tp.description as tasker_description,
          tp.profile_photo as tasker_profile_photo,
          (
            SELECT json_agg(photo_url)
            FROM open_task_photos
            WHERE task_id = ot.id
          ) as photos
        FROM open_task_offers oto
        JOIN open_tasks ot ON oto.task_id = ot.id
        JOIN users u ON oto.tasker_id = u.id
        JOIN tasker_profiles tp ON u.id = tp.user_id
        WHERE oto.id = $1
      `;
      const offerResult = await client.query(offerQuery, [offerId]);
      const offer = offerResult.rows[0];

      if (!offer) {
        throw new Error('Offer not found');
      }

      // Log the hourly rate from the offer
      console.log('Offer details:', {
        hourly_rate: offer.hourly_rate,
        duration: offer.offer_duration,
        date: offer.offer_date,
        time: offer.offer_time
      });

      // Update offer status
      await client.query(
        'UPDATE open_task_offers SET status = $1 WHERE id = $2',
        ['accepted', offer.offer_id]
      );

      // Update task status
      await client.query(
        'UPDATE open_tasks SET status = $1 WHERE id = $2',
        ['assigned', offer.task_id]
      );

      // Delete the accepted offer
      await client.query('DELETE FROM open_task_offers WHERE id = $1', [offer.offer_id]);

      // Get the exact hourly rate from the offer
      const offerRateQuery = `
        SELECT hourly_rate 
        FROM open_task_offers 
        WHERE id = $1
      `;
      const offerRateResult = await client.query(offerRateQuery, [offer.offer_id]);
      const hourlyRate = offerRateResult.rows[0].hourly_rate;

      // Create task request using offer details
      const taskRequestQuery = `
        INSERT INTO task_requests (
          description,
          city_id,
          duration,
          sender_id,
          tasker_id,
          hourly_rate,
          status,
          is_open_task,
          open_task_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const taskRequestResult = await client.query(taskRequestQuery, [
        offer.task_description,      // Use task's original description
        offer.location_id,           // Use task location
        offer.offer_duration,        // Use offer's duration
        offer.creator_id,            // Task creator becomes sender
        offer.tasker_id,            // Tasker from offer
        hourlyRate,                  // Use the exact hourly rate from the offer
        'Waiting for Payment',       // Initial status
        true,                        // Mark as created from open task
        offer.task_id               // Store the original open task ID
      ]);

      // Log the created task request to verify the hourly rate
      console.log('Created task request:', {
        id: taskRequestResult.rows[0].id,
        hourly_rate: taskRequestResult.rows[0].hourly_rate,
        duration: taskRequestResult.rows[0].duration,
        is_open_task: taskRequestResult.rows[0].is_open_task,
        open_task_id: taskRequestResult.rows[0].open_task_id
      });

      // Add availability from the offer
      await client.query(
        `INSERT INTO task_request_availability (task_request_id, date, time_slot)
         VALUES ($1, $2, $3)`,
        [taskRequestResult.rows[0].id, offer.offer_date, offer.offer_time]
      );

      // Add categories from original task
      const categoriesQuery = `
        INSERT INTO task_request_categories (task_request_id, category_id)
        VALUES ($1, $2)
      `;
      await client.query(categoriesQuery, [taskRequestResult.rows[0].id, offer.category_id]);

      // Copy photos from open task to task request
      if (offer.photos && offer.photos.length > 0) {
        for (const photoUrl of offer.photos) {
          if (photoUrl) {
            // Extract just the filename from the full path
            const filename = photoUrl.split('\\').pop().split('/').pop();
            const formattedPath = `images/tasks/${filename}`;
            
            await client.query(
              `INSERT INTO task_request_gallery (task_request_id, image_url)
               VALUES ($1, $2)`,
              [taskRequestResult.rows[0].id, formattedPath]
            );
          }
        }
      }

      // Get creator's name for notification
      const creatorQuery = `
        SELECT name, surname 
        FROM users 
        WHERE id = $1
      `;
      const creatorResult = await client.query(creatorQuery, [offer.creator_id]);
      const creator = creatorResult.rows[0];

      // Send notification to tasker
      const FirebaseService = require('../services/firebaseService');
      await FirebaseService.sendTaskRequestNotification(
        offer.creator_id,
        offer.tasker_id,
        {
          id: taskRequestResult.rows[0].id.toString(),
          title: '✅ Pasiūlymas priimtas',
          description: `${creator.name} ${creator.surname[0]}. priėmė jūsų pasiūlymą.`,
          type: 'offer_accepted'
        }
      );

      // Get the complete task request with all related data
      const completeTaskQuery = `
        SELECT 
          tr.*,
          json_build_object(
            'id', c.id,
            'name', c.name
          ) as city,
          json_agg(DISTINCT cat.*) as categories,
          json_agg(DISTINCT jsonb_build_object(
            'date', tra.date,
            'time', tra.time_slot
          )) as availability,
          json_build_object(
            'id', s.id,
            'name', s.name,
            'surname', s.surname,
            'profile_photo', s.profile_photo
          ) as sender,
          CASE 
            WHEN tr.status = 'Waiting for Payment' THEN
              json_build_object(
                'id', t.id,
                'name', t.name,
                'surname', t.surname,
                'profile_photo', COALESCE(tp.profile_photo, t.profile_photo),
                'description', tp.description,
                'hourly_rate', tr.hourly_rate
              )
            ELSE
              json_build_object(
                'id', t.id,
                'name', t.name,
                'surname', t.surname,
                'profile_photo', COALESCE(tp.profile_photo, t.profile_photo),
                'description', tp.description,
                'hourly_rate', tp.hourly_rate
              )
          END as tasker,
          COALESCE(
            (
              SELECT json_agg(
                CASE 
                  WHEN trg.image_url LIKE 'C:%' OR trg.image_url LIKE '/C:%' 
                  THEN replace(regexp_replace(trg.image_url, '^.*?public[/\\\\]', ''), '\\', '/')
                  ELSE replace(trg.image_url, '\\', '/')
                END
              )
              FROM task_request_gallery trg
              WHERE trg.task_request_id = tr.id
            ),
            '[]'::json
          ) as gallery
        FROM task_requests tr
        JOIN cities c ON tr.city_id = c.id
        JOIN task_request_categories trc ON tr.id = trc.task_request_id
        JOIN categories cat ON trc.category_id = cat.id
        JOIN task_request_availability tra ON tr.id = tra.task_request_id
        JOIN users s ON tr.sender_id = s.id
        JOIN users t ON tr.tasker_id = t.id
        JOIN tasker_profiles tp ON t.id = tp.user_id
        WHERE tr.id = $1
        GROUP BY tr.id, tr.hourly_rate, tr.status, c.id, c.name, s.id, s.name, s.surname, s.profile_photo, 
                 t.id, t.name, t.surname, tp.profile_photo, tp.description, tp.hourly_rate
      `;
      const completeTask = await client.query(completeTaskQuery, [taskRequestResult.rows[0].id]);

      console.log('Final task request:', {
        id: completeTask.rows[0].id,
        tasker: completeTask.rows[0].tasker
      });

      await client.query('COMMIT');
      return completeTask.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get tasks by category
  async getTasksByCategory(categoryId) {
    const query = `
      SELECT 
        ot.*,
        c.id as category_id,
        c.name as category_name,
        json_agg(DISTINCT otp.photo_url) as photos,
        json_agg(DISTINCT jsonb_build_object(
          'date', otd.date,
          'time', otd.time
        )) as dates,
        json_agg(DISTINCT jsonb_build_object(
          'id', oto.id,
          'tasker_id', oto.tasker_id,
          'description', oto.description,
          'hourly_rate', oto.hourly_rate,
          'duration', oto.duration,
          'preferred_date', oto.preferred_date,
          'preferred_time', oto.preferred_time,
          'status', oto.status,
          'created_at', oto.created_at
        )) as offers,
        ci.name as location_name,
        u.name as creator_name,
        u.surname as creator_surname,
        u.profile_photo as creator_photo
      FROM open_tasks ot
      LEFT JOIN categories c ON ot.category_id = c.id
      LEFT JOIN open_task_photos otp ON ot.id = otp.task_id
      LEFT JOIN open_task_dates otd ON ot.id = otd.task_id
      LEFT JOIN open_task_offers oto ON ot.id = oto.task_id
      LEFT JOIN cities ci ON ot.location_id = ci.id
      LEFT JOIN users u ON ot.creator_id = u.id
      WHERE ot.category_id = $1 AND ot.status = 'open'
      GROUP BY ot.id, c.id, c.name, ci.name, u.name, u.surname, u.profile_photo
      ORDER BY ot.created_at DESC
    `;
    const result = await pool.query(query, [categoryId]);
    return result.rows;
  }

  // Get all offers for a specific task
  async getTaskOffers(taskId) {
    const query = `
      SELECT 
        oto.id,
        oto.task_id as "taskId",
        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'surname', u.surname,
          'email', u.email,
          'profile_photo', COALESCE(tp.profile_photo, u.profile_photo)
        ) as tasker,
        oto.description,
        oto.hourly_rate as price,
        oto.duration,
        jsonb_build_object(
          'date', oto.preferred_date,
          'time', oto.preferred_time
        ) as availability,
        oto.status
      FROM open_task_offers oto
      JOIN users u ON oto.tasker_id = u.id
      LEFT JOIN tasker_profiles tp ON u.id = tp.user_id
      WHERE oto.task_id = $1
      ORDER BY oto.created_at DESC
    `;
    const result = await pool.query(query, [taskId]);
    return result.rows;
  }

  // Get specific offer by ID
  async getOfferById(offerId) {
    const query = `
      SELECT 
        oto.*,
        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'surname', u.surname,
          'profile_photo', u.profile_photo
        ) as tasker,
        jsonb_build_object(
          'id', ot.id,
          'description', ot.description,
          'budget', ot.budget,
          'duration', ot.duration,
          'status', ot.status
        ) as task
      FROM open_task_offers oto
      JOIN users u ON oto.tasker_id = u.id
      JOIN open_tasks ot ON oto.task_id = ot.id
      WHERE oto.id = $1
    `;
    const result = await pool.query(query, [offerId]);
    return result.rows[0];
  }

  // Delete an open task and all related data
  async delete(taskId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete related records first (due to foreign key constraints)
      await client.query('DELETE FROM open_task_photos WHERE task_id = $1', [taskId]);
      await client.query('DELETE FROM open_task_dates WHERE task_id = $1', [taskId]);
      await client.query('DELETE FROM open_task_offers WHERE task_id = $1', [taskId]);
      
      // Delete the task itself
      await client.query('DELETE FROM open_tasks WHERE id = $1', [taskId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Delete expired dates from open tasks
  async deleteExpiredDates() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete dates that have passed
      const query = `
        DELETE FROM open_task_dates
        WHERE date < CURRENT_DATE
        OR (date = CURRENT_DATE AND time < CURRENT_TIME)
      `;
      
      const result = await client.query(query);
      console.log(`Deleted ${result.rowCount} expired dates`);

      await client.query('COMMIT');
      return result.rowCount;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting expired dates:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Delete open tasks without dates
  async deleteOpenTasksWithoutDates() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find and delete open tasks that have no dates
      const query = `
        WITH tasks_without_dates AS (
          SELECT ot.id
          FROM open_tasks ot
          LEFT JOIN open_task_dates otd ON ot.id = otd.task_id
          WHERE ot.status = 'open'
          GROUP BY ot.id
          HAVING COUNT(otd.id) = 0
        )
        DELETE FROM open_tasks
        WHERE id IN (SELECT id FROM tasks_without_dates)
        RETURNING id
      `;
      
      const result = await client.query(query);
      console.log(`Deleted ${result.rowCount} open tasks without dates`);

      await client.query('COMMIT');
      return result.rowCount;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting open tasks without dates:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = OpenTask; 