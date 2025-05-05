const BaseModel = require('./BaseModel');
const pool = require('../config/database');

class SupportTicket extends BaseModel {
  constructor() {
    super('support_tickets');
    this.initialize();
  }

  async initialize() {
    try {
      await this.createSupportTicketTable();
      await this.addSenderDetailsColumns();
      console.log('SupportTicket model initialized successfully');
    } catch (error) {
      console.error('Error initializing SupportTicket model:', error);
    }
  }

  async createSupportTicketTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'pending'
      )
    `;
    await pool.query(query);
  }

  async addSenderDetailsColumns() {
    const columnsToAdd = [
      {
        name: 'sender_name',
        type: 'VARCHAR(100)',
        default: null
      },
      {
        name: 'sender_surname',
        type: 'VARCHAR(100)',
        default: null
      },
      {
        name: 'sender_email',
        type: 'VARCHAR(255)',
        default: null
      }
    ];

    for (const column of columnsToAdd) {
      const checkQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'support_tickets' 
        AND column_name = $1
      `;
      const result = await pool.query(checkQuery, [column.name]);

      if (result.rows.length === 0) {
        const alterQuery = `
          ALTER TABLE support_tickets 
          ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}
        `;
        await pool.query(alterQuery);
        console.log(`Added ${column.name} column to support_tickets table`);
      }
    }
  }

  async createTicket(ticketData) {
    const { sender_id, sender_name, sender_surname, sender_email, type, content } = ticketData;
    const query = `
      INSERT INTO support_tickets (
        sender_id, 
        sender_name, 
        sender_surname, 
        sender_email, 
        type, 
        content
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await pool.query(query, [
      sender_id,
      sender_name,
      sender_surname,
      sender_email,
      type,
      content
    ]);
    return result.rows[0];
  }

  async getTicketById(id) {
    const query = `
      SELECT *
      FROM support_tickets
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  async getTicketsBySenderId(senderId) {
    const query = `
      SELECT *
      FROM support_tickets
      WHERE sender_id = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [senderId]);
    return result.rows;
  }
}

module.exports = new SupportTicket(); 