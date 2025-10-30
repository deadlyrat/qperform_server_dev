// qperform-server/server.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = 3001;

// Middleware
app.use(cors({
    // Allows both localhost and 127.0.0.1 origins for local dev
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

// Database connection
const pool = new Pool({
    // Use .trim() to strip ALL leading/trailing whitespace (including newlines and carriage returns)
    user: process.env.DB_USER ? process.env.DB_USER.trim() : undefined, 
    host: process.env.DB_HOST ? process.env.DB_HOST.trim() : undefined,
    database: process.env.DB_NAME ? process.env.DB_NAME.trim() : undefined,
    // This line is the ABSOLUTE critical fix for the password format error
    password: process.env.DB_PASSWORD ? process.env.DB_PASSWORD.trim() : undefined,
    port: parseInt(process.env.DB_PORT || '25060'), 
    ssl: false, // Must be false if your server doesn't support SSL
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        // If connection fails, log the specific error
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ Database connected at:', res.rows[0].now);
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- API Routes ---

// Get filter options (months, years, categories, clients, tasks)
app.get('/api/filters', async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT month_name, year_num, category, client, task 
            FROM consolidations.data_qperform_weekly
        `;
        const { rows } = await pool.query(query);

        const filters = {
            months: [...new Set(rows.map(r => r.month_name))].filter(Boolean),
            years: [...new Set(rows.map(r => r.year_num))].filter(Boolean).sort((a, b) => b - a),
            categories: [...new Set(rows.map(r => r.category))].filter(Boolean).sort(),
            clients: [...new Set(rows.map(r => r.client))].filter(Boolean).sort(),
            tasks: [...new Set(rows.map(r => r.task))].filter(Boolean).sort(),
        };

        res.json(filters);
    } catch (err) {
        console.error('❌ Error fetching filters:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get monthly summary data (aggregated by client and category)
app.get('/api/monthly-summary', async (req, res) => {
    try {
        const { month, year } = req.query;

        let query = `
            SELECT 
                client,
                category,
                COUNT(DISTINCT agent_id) as total_aftes,
                COUNT(DISTINCT CASE 
                    WHEN flag_qa = 'Critical' OR flag_qa = 'Low' 
                    OR flag_prod = 'Critical' OR flag_prod = 'Low' 
                    THEN agent_id 
                END) as underperformers,
                COUNT(DISTINCT week_range) as weeks_with_issues,
                ROUND(AVG(kpi_qa), 2) as avg_score
            FROM consolidations.data_qperform_weekly
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (month) {
            query += ` AND month_name = $${paramCount}`;
            params.push(month);
            paramCount++;
        }

        if (year) {
            query += ` AND year_num = $${paramCount}`;
            params.push(parseInt(year));
            paramCount++;
        }

        query += ` GROUP BY client, category ORDER BY client, category`;

        const { rows } = await pool.query(query, params);
        console.log(`✅ Retrieved ${rows.length} summary records`);

        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching monthly summary:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// NEW ROUTE: Get client summary data (aggregated by client only)
app.get('/api/client-summary', async (req, res) => {
    try {
        const { month, year } = req.query;
        
        let query = `
            SELECT 
                client,
                COUNT(DISTINCT agent_id) as total_aftes,
                COUNT(DISTINCT CASE 
                    WHEN flag_qa = 'Critical' OR flag_qa = 'Low' 
                    OR flag_prod = 'Critical' OR flag_prod = 'Low' 
                    THEN agent_id 
                END) as underperformers,
                COUNT(DISTINCT week_range) as weeks_with_issues,
                ROUND(AVG(kpi_qa * 100), 2) as avg_score
            FROM consolidations.data_qperform_weekly
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 1;
        
        if (month) {
            query += ` AND month_name = $${paramCount}`;
            params.push(month);
            paramCount++;
        }
        
        if (year) {
            query += ` AND year_num = $${paramCount}`;
            params.push(parseInt(year));
            paramCount++;
        }
        
        query += ` GROUP BY client ORDER BY client`;
        
        const { rows } = await pool.query(query, params);
        console.log(`✅ Retrieved ${rows.length} client summary records`);
        
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching client summary:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get detailed weekly performance data (used for underperforming view grid)
app.get('/api/performance-data', async (req, res) => {
    try {
        const { month, year, category, client, task } = req.query;

        let query = `
            SELECT * FROM consolidations.data_qperform_weekly
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (month) {
            query += ` AND month_name = $${paramCount}`;
            params.push(month);
            paramCount++;
        }
        if (year) {
            query += ` AND year_num = $${paramCount}`;
            params.push(parseInt(year));
            paramCount++;
        }
        if (category) {
            query += ` AND category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        if (client) {
            query += ` AND client = $${paramCount}`;
            params.push(client);
            paramCount++;
        }
        if (task) {
            query += ` AND task = $${paramCount}`;
            params.push(task);
            paramCount++;
        }

        query += ` ORDER BY agent_email, start_date`;

        const { rows } = await pool.query(query, params);
        console.log(`✅ Retrieved ${rows.length} detailed performance records`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching performance data:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// ACTION LOG (Persistence Implemented)
app.get('/api/action-log', async (req, res) => {
    try {
        const query = `
            SELECT 
                id,
                agent_email,
                action_type,
                description,
                taken_by,
                action_date,
                client,
                category
            FROM consolidations.action_log
            ORDER BY action_date DESC
        `;
        
        const { rows } = await pool.query(query);
        console.log(`✅ Retrieved ${rows.length} action log records`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching action log:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

app.post('/api/action-log', async (req, res) => {
    try {
        const { 
            agent_email, 
            action_type, 
            description, 
            taken_by, 
            client, 
            category,
            agent_id 
        } = req.body;
        
        const query = `
            INSERT INTO consolidations.action_log 
            (agent_email, agent_id, client, category, action_type, description, taken_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, action_date;
        `;
        
        const params = [
            agent_email, 
            agent_id, 
            client, 
            category, 
            action_type, 
            description, 
            taken_by
        ];
        
        const { rows } = await pool.query(query, params);
        
        res.json({ 
            success: true, 
            message: 'Action created successfully',
            id: rows[0].id,
            action_date: rows[0].action_date
        });
    } catch (err) {
        console.error('❌ Error creating action:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});


// Get table structure (debugging)
app.get('/api/table-info', async (req, res) => {
    try {
        const query = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'consolidations' 
            AND table_name = 'data_qperform_weekly'
            ORDER BY ordinal_position;
        `;
        
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching table info:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(port, () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 QPerform API Server running`);
    console.log(`📍 URL: http://localhost:${port}`);
    console.log('🔗 Health: http://localhost:3001/api/health');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});