const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function initializeDatabase() {
    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, '../config/init-db.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Execute the SQL
        await pool.query(sql);
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        // Close the pool
        await pool.end();
    }
}

// Run the initialization
initializeDatabase(); 