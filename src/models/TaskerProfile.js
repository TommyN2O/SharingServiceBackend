const BaseModel = require('./BaseModel');
const pool = require('../config/database');
const _auth = require('../middleware/auth');
const _City = require('./City');

class TaskerProfile extends BaseModel {
  constructor() {
    super('tasker_profiles');
    this.initialize();
  }

  async initialize() {
    try {
      // Create tasker_profiles table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasker_profiles (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          profile_photo TEXT,
          description TEXT,
          hourly_rate DECIMAL(10,2),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // Create tasker_categories table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasker_categories (
          tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
          PRIMARY KEY (tasker_id, category_id)
        );
      `);

      // Create tasker_cities table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasker_cities (
          tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
          city_id INTEGER,
          PRIMARY KEY (tasker_id, city_id)
        );
      `);

      // Create tasker_availability table without dropping
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasker_availability (
          tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
          date DATE NOT NULL,
          time_slot TIME NOT NULL,
          PRIMARY KEY (tasker_id, date, time_slot)
        );
      `);

      // Create tasker_gallery table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasker_gallery (
          id SERIAL PRIMARY KEY,
          tasker_id INTEGER REFERENCES tasker_profiles(id) ON DELETE CASCADE,
          image_url TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // Create task_requests table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_requests (
          id SERIAL PRIMARY KEY,
          description TEXT NOT NULL,
          city_id INTEGER NOT NULL,
          duration TEXT NOT NULL,
          sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          tasker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // Create task_request_categories table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_request_categories (
          task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
          PRIMARY KEY (task_request_id, category_id)
        );
      `);

      // Create task_request_availability table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_request_availability (
          task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
          date DATE NOT NULL,
          time_slot TIME NOT NULL,
          PRIMARY KEY (task_request_id, date, time_slot)
        );
      `);

      // Create task_request_gallery table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_request_gallery (
          id SERIAL PRIMARY KEY,
          task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
          image_url TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      console.log('TaskerProfile tables initialized successfully');
    } catch (error) {
      console.error('Error initializing TaskerProfile tables:', error);
      throw error;
    }
  }

  // Create tasker profile
  async create(data) {
    const {
      user_id, profile_photo, description, hourly_rate,
    } = data;
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
    try {
      // Validate date and time
      if (!date || !time) {
        throw new Error('Date and time are required for availability');
      }

      // Ensure date is in YYYY-MM-DD format
      let formattedDate;
      if (date instanceof Date) {
        formattedDate = date.toISOString().split('T')[0];
      } else if (typeof date === 'string') {
        // Try to parse the date string
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
          throw new Error('Invalid date format. Please use YYYY-MM-DD format');
        }
        formattedDate = parsedDate.toISOString().split('T')[0];
      } else {
        throw new Error('Invalid date format');
      }

      // Validate time format (HH:mm:ss)
      if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(time)) {
        throw new Error('Invalid time format. Must be in HH:mm:ss format');
      }

      const query = `
        INSERT INTO tasker_availability (tasker_id, date, time_slot)
        VALUES ($1, $2, $3::time)
        ON CONFLICT (tasker_id, date, time_slot) DO NOTHING
        RETURNING *
      `;

      const result = await pool.query(query, [tasker_id, formattedDate, time]);
      return result.rows[0];
    } catch (error) {
      console.error('Error adding availability:', error);
      throw error;
    }
  }

  // Get complete profile with all details
  async getCompleteProfile(userId) {
    const query = `
      SELECT 
        tp.id,
        CASE 
          WHEN tp.profile_photo IS NULL THEN NULL
          WHEN tp.profile_photo LIKE 'http%' THEN tp.profile_photo
          WHEN tp.profile_photo LIKE 'images/%' THEN tp.profile_photo
          ELSE CONCAT('images/', tp.profile_photo)
        END as profile_photo,
        tp.description,
        tp.hourly_rate,
        ROUND(COALESCE(AVG(r.rating), 0)::numeric, 2) as rating,
        COUNT(DISTINCT r.id) as review_count,
        u.name,
        u.surname,
        u.email,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object('id', c.id, 'name', c.name)
            FROM tasker_categories tc
            JOIN categories c ON tc.category_id = c.id
            WHERE tc.tasker_id = tp.id
          ),
          ARRAY[]::jsonb[]
        ) as categories,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object('id', c.id, 'name', c.name)
            FROM tasker_cities tc
            JOIN cities c ON tc.city_id = c.id
            WHERE tc.tasker_id = tp.id
          ),
          ARRAY[]::jsonb[]
        ) as cities,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object(
              'date', to_char(ta.date, 'YYYY-MM-DD'),
              'time', to_char(ta.time_slot::time, 'HH24:MI:SS')
            )
            FROM tasker_availability ta
            WHERE ta.tasker_id = tp.id
            ORDER BY ta.date, ta.time_slot
          ),
          ARRAY[]::jsonb[]
        ) as availability,
        COALESCE(
          ARRAY(
            SELECT 
              CASE
                WHEN tg.image_url LIKE 'images/%' THEN tg.image_url
                ELSE CONCAT('images/', tg.image_url)
              END
            FROM tasker_gallery tg
            WHERE tg.tasker_id = tp.id
            ORDER BY tg.created_at DESC
          ),
          ARRAY[]::text[]
        ) as gallery
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN task_requests tr ON tp.user_id = tr.tasker_id
      LEFT JOIN reviews r ON tr.id = r.task_request_id
      WHERE tp.user_id = $1
      GROUP BY tp.id, u.id
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return null;
    }

    const profile = result.rows[0];

    // Format the response
    return {
      id: profile.id,
      profile_photo: profile.profile_photo,
      description: profile.description || '',
      hourly_rate: profile.hourly_rate ? profile.hourly_rate.toString() : '0.00',
      rating: parseFloat(profile.rating) || 0,
      review_count: parseInt(profile.review_count) || 0,
      name: profile.name,
      surname: profile.surname,
      email: profile.email,
      categories: Array.isArray(profile.categories) ? profile.categories : [],
      cities: Array.isArray(profile.cities) ? profile.cities : [],
      availability: Array.isArray(profile.availability) ? profile.availability : [],
      gallery: Array.isArray(profile.gallery) ? profile.gallery : [],
    };
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
    }
    return this.create({
      user_id,
      ...profileData,
    });
  }

  async getTopTaskers(limit = 10) {
    const query = `
      SELECT tp.*, u.name, u.surname, 
             COUNT(DISTINCT tr.id) as completed_tasks,
             AVG(r.rating) as average_rating
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN task_requests tr ON tp.user_id = tr.tasker_id AND tr.status = 'completed'
      LEFT JOIN reviews r ON tr.id = r.task_request_id
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
             COUNT(DISTINCT tr.id) as completed_tasks,
             AVG(r.rating) as average_rating
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      LEFT JOIN task_requests tr ON tp.user_id = tr.tasker_id AND tr.status = 'completed'
      LEFT JOIN reviews r ON tr.id = r.task_request_id
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
  async addGalleryPhoto(tasker_id, image_url) {
    // Remove any 'images/' prefix if it exists and get just the relative path
    const relativePath = image_url.replace(/^images\//, '');

    const query = `
      INSERT INTO tasker_gallery (tasker_id, image_url)
      VALUES ($1, $2)
      RETURNING *
    `;
    const result = await pool.query(query, [tasker_id, relativePath]);
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

  // Update tasker profile
  async update(user_id, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      console.log('Update data received:', data);

      // 1. Update main profile data
      const {
        profile_photo, description, hourly_rate, categories, cities, availability,
      } = data;

      console.log('Extracted availability:', availability);

      const updateQuery = `
        UPDATE tasker_profiles
        SET 
          profile_photo = COALESCE($1, profile_photo),
          description = COALESCE($2, description),
          hourly_rate = COALESCE($3, hourly_rate),
          updated_at = NOW()
        WHERE user_id = $4
        RETURNING *
      `;

      const result = await client.query(updateQuery, [
        profile_photo,
        description,
        hourly_rate,
        user_id,
      ]);

      const taskerProfile = result.rows[0];
      if (!taskerProfile) {
        throw new Error('Tasker profile not found');
      }

      // 2. Update categories if provided
      if (Array.isArray(categories)) {
        // Delete existing categories
        await client.query('DELETE FROM tasker_categories WHERE tasker_id = $1', [taskerProfile.id]);

        // Add new categories
        for (const category of categories) {
          const categoryId = typeof category === 'object' ? category.id : category;
          await client.query(
            'INSERT INTO tasker_categories (tasker_id, category_id) VALUES ($1, $2)',
            [taskerProfile.id, categoryId],
          );
        }
      }

      // 3. Update cities if provided
      if (Array.isArray(cities)) {
        // Delete existing cities
        await client.query('DELETE FROM tasker_cities WHERE tasker_id = $1', [taskerProfile.id]);

        // Add new cities
        for (const city of cities) {
          const cityId = typeof city === 'object' ? city.id : city;
          await client.query(
            'INSERT INTO tasker_cities (tasker_id, city_id) VALUES ($1, $2)',
            [taskerProfile.id, cityId],
          );
        }
      }

      // 4. Update availability if provided and not empty
      if (Array.isArray(availability) && availability.length > 0) {
        console.log('Raw availability data:', JSON.stringify(availability, null, 2));

        // Delete existing availability
        const deleteResult = await client.query('DELETE FROM tasker_availability WHERE tasker_id = $1', [taskerProfile.id]);
        console.log('Deleted existing availability:', {
          tasker_id: taskerProfile.id,
          rowsDeleted: deleteResult.rowCount,
        });

        // Add new availability
        const insertionErrors = [];
        for (const slot of availability) {
          try {
            let dateStr; let
              timeStr;

            if (typeof slot === 'string') {
              // Handle string format "YYYY-MM-DD HH:mm:ss"
              [dateStr, timeStr] = slot.split(' ');
            } else if (slot.date && slot.time) {
              // Handle object format from Kotlin AvailabilitySlot
              dateStr = slot.date;
              timeStr = slot.time;
            } else {
              console.warn('Invalid slot format:', slot);
              insertionErrors.push({ slot, error: 'Invalid slot format' });
              continue;
            }

            if (!dateStr || !timeStr) {
              console.warn('Missing date or time:', { dateStr, timeStr });
              insertionErrors.push({ slot, error: 'Missing date or time' });
              continue;
            }

            // Ensure date is in YYYY-MM-DD format
            const dateObj = new Date(dateStr);
            if (isNaN(dateObj.getTime())) {
              console.warn('Invalid date:', dateStr);
              insertionErrors.push({ slot, error: 'Invalid date format' });
              continue;
            }
            const formattedDate = dateObj.toISOString().split('T')[0];

            // Handle time format
            let formattedTime;
            if (timeStr.includes(':')) {
              // If time already has colons, ensure it has seconds
              formattedTime = timeStr.split(':').length === 2 ? `${timeStr}:00` : timeStr;
            } else {
              // If time is in another format, try to parse it
              try {
                const timeObj = new Date(`1970-01-01T${timeStr}`);
                formattedTime = timeObj.toTimeString().split(' ')[0];
              } catch (e) {
                console.warn('Invalid time format:', timeStr);
                insertionErrors.push({ slot, error: 'Invalid time format' });
                continue;
              }
            }

            await client.query(
              'INSERT INTO tasker_availability (tasker_id, date, time_slot) VALUES ($1, $2, $3::time)',
              [taskerProfile.id, formattedDate, formattedTime],
            );
          } catch (error) {
            console.error('Error inserting availability:', {
              slot,
              error: error.message,
            });
            insertionErrors.push({ slot, error: error.message });
          }
        }

        // Log any errors that occurred during insertion
        if (insertionErrors.length > 0) {
          console.warn('Some availability slots failed to insert:', insertionErrors);
        }
      } else {
        // If availability is empty array or not provided, just clear existing availability
        await client.query('DELETE FROM tasker_availability WHERE tasker_id = $1', [taskerProfile.id]);
        console.log('Cleared existing availability as no new slots were provided');
      }

      // Get the updated profile with all related data
      const updatedProfile = await this.getCompleteProfile(user_id);

      await client.query('COMMIT');
      return updatedProfile;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get all tasker profiles with complete information
  async getAllProfiles(filters = {}) {
    // Normalize filters
    const normalizedFilters = {
      ...filters,
      rating: filters.rating ? parseFloat(filters.rating) : undefined,
      category: filters.category ? parseInt(filters.category) : undefined,
      minPrice: filters.minPrice !== null ? parseFloat(filters.minPrice) : undefined,
      maxPrice: filters.maxPrice !== null ? parseFloat(filters.maxPrice) : undefined,
      excludeUserId: filters.excludeUserId, // Add excludeUserId to normalized filters
    };

    console.log('Original filters:', filters);
    console.log('Normalized filters:', normalizedFilters);

    let query = `
      WITH tasker_ratings AS (
        SELECT 
          tp.id as tasker_id,
          ROUND(COALESCE(AVG(r.rating), 0)::numeric, 2) as avg_rating,
          COUNT(DISTINCT r.id) as review_count
        FROM tasker_profiles tp
        LEFT JOIN users u ON tp.user_id = u.id
        LEFT JOIN task_requests tr ON tp.user_id = tr.tasker_id
        LEFT JOIN reviews r ON tr.id = r.task_request_id
        GROUP BY tp.id
      )
      SELECT DISTINCT
        tp.id,
        CASE 
          WHEN tp.profile_photo IS NULL THEN NULL
          WHEN tp.profile_photo LIKE 'http%' THEN tp.profile_photo
          WHEN tp.profile_photo LIKE 'images/%' THEN tp.profile_photo
          ELSE CONCAT('images/', tp.profile_photo)
        END as profile_photo,
        tp.description,
        tp.hourly_rate,
        tr.avg_rating as rating,
        tr.review_count,
        u.name,
        u.surname,
        u.email,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object('id', c2.id, 'name', c2.name)
            FROM tasker_categories tc2
            JOIN categories c2 ON tc2.category_id = c2.id
            WHERE tc2.tasker_id = tp.id
          ),
          ARRAY[]::jsonb[]
        ) as categories,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object('id', ci2.id, 'name', ci2.name)
            FROM tasker_cities tci2
            JOIN cities ci2 ON tci2.city_id = ci2.id
            WHERE tci2.tasker_id = tp.id
          ),
          ARRAY[]::jsonb[]
        ) as cities,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object(
              'date', to_char(ta2.date, 'YYYY-MM-DD'),
              'time', to_char(ta2.time_slot, 'HH24:MI:SS')
            )
            FROM tasker_availability ta2
            WHERE ta2.tasker_id = tp.id
            ORDER BY ta2.date, ta2.time_slot
          ),
          ARRAY[]::jsonb[]
        ) as availability,
        COALESCE(
          ARRAY(
            SELECT 
              CASE
                WHEN tg2.image_url LIKE 'images/%' THEN tg2.image_url
                ELSE CONCAT('images/', tg2.image_url)
              END
            FROM tasker_gallery tg2
            WHERE tg2.tasker_id = tp.id
            ORDER BY tg2.created_at DESC
          ),
          ARRAY[]::text[]
        ) as gallery
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      JOIN tasker_ratings tr ON tr.tasker_id = tp.id
    `;

    const queryParams = [];
    const conditions = [];

    // Add condition to exclude user's own profile
    if (normalizedFilters.excludeUserId) {
      queryParams.push(normalizedFilters.excludeUserId);
      conditions.push(`tp.user_id != $${queryParams.length}`);
    }

    // Add city filter if provided
    if (normalizedFilters.city) {
      const cityIds = normalizedFilters.city.split(',').map((id) => parseInt(id.trim())).filter((id) => !isNaN(id));
      if (cityIds.length > 0) {
        queryParams.push(cityIds);
        query += `
        JOIN tasker_cities tc ON tp.id = tc.tasker_id
        `;
        conditions.push(`tc.city_id = ANY($${queryParams.length})`);
      }
    }

    // Add category filter if provided
    if (normalizedFilters.category) {
      queryParams.push(normalizedFilters.category);
      query += `
      JOIN tasker_categories tcat ON tp.id = tcat.tasker_id
      `;
      conditions.push(`tcat.category_id = $${queryParams.length}`);
    }

    // Add date and time availability filters
    if (normalizedFilters.date) {
      queryParams.push(normalizedFilters.date);
      query += `
      JOIN tasker_availability ta ON tp.id = ta.tasker_id
      `;
      conditions.push(`ta.date = $${queryParams.length}::date`);

      // Add time range filter if both timeFrom and timeTo are provided
      if (normalizedFilters.timeFrom && normalizedFilters.timeTo) {
        queryParams.push(`${normalizedFilters.timeFrom}:00`, `${normalizedFilters.timeTo}:00`);
        conditions.push(`ta.time_slot BETWEEN $${queryParams.length - 1}::time AND $${queryParams.length}::time`);
      }
    }

    // Add price range filters
    if (normalizedFilters.minPrice !== undefined && !isNaN(normalizedFilters.minPrice)) {
      queryParams.push(normalizedFilters.minPrice);
      conditions.push(`tp.hourly_rate >= $${queryParams.length}`);
    }

    if (normalizedFilters.maxPrice !== undefined && !isNaN(normalizedFilters.maxPrice)) {
      queryParams.push(normalizedFilters.maxPrice);
      conditions.push(`tp.hourly_rate <= $${queryParams.length}`);
    }

    // Add rating filter
    if (normalizedFilters.rating !== undefined && !isNaN(normalizedFilters.rating)) {
      queryParams.push(normalizedFilters.rating);
      conditions.push(`tr.avg_rating >= $${queryParams.length}`);
    }

    // Build the WHERE clause
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += `
      ORDER BY tr.avg_rating DESC, tr.review_count DESC
    `;

    console.log('Final query:', query);
    console.log('Final parameters:', queryParams);

    const result = await pool.query(query, queryParams);

    return result.rows.map((profile) => ({
      ...profile,
      hourly_rate: profile.hourly_rate ? profile.hourly_rate.toString() : '0.00',
      description: profile.description || '',
      categories: Array.isArray(profile.categories) ? profile.categories : [],
      cities: Array.isArray(profile.cities) ? profile.cities : [],
      availability: Array.isArray(profile.availability) ? profile.availability : [],
      gallery: Array.isArray(profile.gallery) ? profile.gallery : [],
    }));
  }

  // Get tasker profile by profile ID
  async getProfileById(profileId) {
    const query = `
      WITH tasker_ratings AS (
        SELECT 
          tp.id as tasker_id,
          ROUND(COALESCE(AVG(r.rating), 0)::numeric, 2) as avg_rating,
          COUNT(DISTINCT r.id) as review_count
        FROM tasker_profiles tp
        LEFT JOIN users u ON tp.user_id = u.id
        LEFT JOIN task_requests tr ON tp.user_id = tr.tasker_id
        LEFT JOIN reviews r ON tr.id = r.task_request_id
        WHERE tp.id = $1
        GROUP BY tp.id
      )
      SELECT 
        tp.id,
        CASE 
          WHEN tp.profile_photo IS NULL THEN NULL
          WHEN tp.profile_photo LIKE 'http%' THEN tp.profile_photo
          WHEN tp.profile_photo LIKE 'images/%' THEN tp.profile_photo
          ELSE CONCAT('images/', tp.profile_photo)
        END as profile_photo,
        tp.description,
        tp.hourly_rate,
        tr.avg_rating as rating,
        tr.review_count,
        u.name,
        u.surname,
        u.email,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object('id', c2.id, 'name', c2.name)
            FROM tasker_categories tc2
            JOIN categories c2 ON tc2.category_id = c2.id
            WHERE tc2.tasker_id = tp.id
          ),
          ARRAY[]::jsonb[]
        ) as categories,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object('id', ci2.id, 'name', ci2.name)
            FROM tasker_cities tci2
            JOIN cities ci2 ON tci2.city_id = ci2.id
            WHERE tci2.tasker_id = tp.id
          ),
          ARRAY[]::jsonb[]
        ) as cities,
        COALESCE(
          ARRAY(
            SELECT jsonb_build_object(
              'date', to_char(ta2.date, 'YYYY-MM-DD'),
              'time', to_char(ta2.time_slot, 'HH24:MI:SS')
            )
            FROM tasker_availability ta2
            WHERE ta2.tasker_id = tp.id
            ORDER BY ta2.date, ta2.time_slot
          ),
          ARRAY[]::jsonb[]
        ) as availability,
        COALESCE(
          ARRAY(
            SELECT 
              CASE
                WHEN tg2.image_url LIKE 'images/%' THEN tg2.image_url
                ELSE CONCAT('images/', tg2.image_url)
              END
            FROM tasker_gallery tg2
            WHERE tg2.tasker_id = tp.id
            ORDER BY tg2.created_at DESC
          ),
          ARRAY[]::text[]
        ) as gallery
      FROM tasker_profiles tp
      JOIN users u ON tp.user_id = u.id
      JOIN tasker_ratings tr ON tr.tasker_id = tp.id
      WHERE tp.id = $1
    `;

    const result = await pool.query(query, [profileId]);

    if (result.rows.length === 0) {
      return null;
    }

    const profile = result.rows[0];

    return {
      ...profile,
      hourly_rate: profile.hourly_rate ? profile.hourly_rate.toString() : '0.00',
      description: profile.description || '',
      categories: Array.isArray(profile.categories) ? profile.categories : [],
      cities: Array.isArray(profile.cities) ? profile.cities : [],
      availability: Array.isArray(profile.availability) ? profile.availability : [],
      gallery: Array.isArray(profile.gallery) ? profile.gallery : [],
    };
  }
}

module.exports = new TaskerProfile();
