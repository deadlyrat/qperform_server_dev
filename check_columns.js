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

async function checkColumns() {
    try {
        const query = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'consolidations' 
              AND table_name = 'data_qperform_weekly'
            ORDER BY ordinal_position
        `;
        const result = await pool.query(query);
        console.log('Columns in data_qperform_weekly:');
        result.rows.forEach(row => {
            console.log(`  ${row.column_name} (${row.data_type})`);
        });
        
        // Now get sample data
        const sampleQuery = `SELECT * FROM consolidations.data_qperform_weekly LIMIT 1`;
        const sampleResult = await pool.query(sampleQuery);
        console.log('\nSample row data:');
        if (sampleResult.rows.length > 0) {
            Object.keys(sampleResult.rows[0]).forEach(key => {
                console.log(`  ${key}: ${sampleResult.rows[0][key]}`);
            });
        }
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

checkColumns();
