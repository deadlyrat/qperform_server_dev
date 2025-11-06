require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER ? process.env.DB_USER.trim() : undefined,
    host: process.env.DB_HOST ? process.env.DB_HOST.trim() : undefined,
    database: process.env.DB_NAME ? process.env.DB_NAME.trim() : undefined,
    password: process.env.DB_PASSWORD ? process.env.DB_PASSWORD.trim() : undefined,
    port: parseInt(process.env.DB_PORT || '25060'),
    ssl: { rejectUnauthorized: false }
});

async function checkNames() {
    try {
        const query = `
            SELECT DISTINCT agent_name, agent_email 
            FROM consolidations.data_qperform_weekly 
            WHERE agent_name IS NOT NULL
            LIMIT 10
        `;
        const result = await pool.query(query);
        console.log('Sample agent names from database:');
        result.rows.forEach(row => {
            console.log(`  agent_name: "${row.agent_name}" | agent_email: "${row.agent_email}"`);
        });
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkNames();
