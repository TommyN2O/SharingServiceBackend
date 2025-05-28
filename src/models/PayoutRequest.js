const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class PayoutRequest extends BaseModel {
  constructor() {
    super('payout_requests');
    this.initialize();
  }

  async initialize() {
    try {
      await this.createPayoutRequestsTable();
      await this.migrateAmountToDecimal();
      console.log('PayoutRequest model initialized successfully');
    } catch (error) {
      console.error('Error initializing PayoutRequest model:', error);
    }
  }

  async createPayoutRequestsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS payout_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'paid')),
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `;
    await pool.query(query);
  }

  async createPayoutRequest(userId, amount) {
    const query = `
      INSERT INTO payout_requests (user_id, amount)
      VALUES ($1, $2)
      RETURNING *
    `;
    const result = await pool.query(query, [userId, amount]);
    return result.rows[0];
  }

  async getPayoutRequestsByUser(userId) {
    const query = `
      SELECT 
        pr.*,
        u.wallet_bank_iban
      FROM payout_requests pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.user_id = $1
      ORDER BY pr.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  async updatePayoutRequestStatus(id, status) {
    const query = `
      UPDATE payout_requests
      SET 
        status = $2,
        paid_at = CASE WHEN $2 = 'paid' THEN NOW() ELSE paid_at END
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id, status]);
    return result.rows[0];
  }

  // Migrate amount column to NUMERIC(10,2)
  async migrateAmountToDecimal() {
    const query = `
      DO $$ 
      BEGIN 
        -- Check if the column is not already NUMERIC(10,2)
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'payout_requests' 
          AND column_name = 'amount'
          AND data_type != 'numeric'
        ) THEN 
          -- Create a temporary column
          ALTER TABLE payout_requests ADD COLUMN amount_new NUMERIC(10,2);
          
          -- Copy data from old column to new, converting from cents to decimal
          UPDATE payout_requests SET amount_new = CAST(amount AS NUMERIC) / 100;
          
          -- Drop the old column
          ALTER TABLE payout_requests DROP COLUMN amount;
          
          -- Rename the new column
          ALTER TABLE payout_requests RENAME COLUMN amount_new TO amount;
          
          RAISE NOTICE 'Successfully migrated amount column to NUMERIC(10,2)';
        END IF;
      END $$;
    `;
    await pool.query(query);
    console.log('Amount migration completed successfully');
  }
}

module.exports = new PayoutRequest(); 