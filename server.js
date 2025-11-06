// qperform-server/server.js
require('dotenv').config();

// Debug: Check if env vars are loaded
console.log('🔍 Debug - DB_USER:', process.env.DB_USER ? 'LOADED' : 'NOT LOADED');
console.log('🔍 Debug - DB_PASSWORD:', process.env.DB_PASSWORD ? 'LOADED' : 'NOT LOADED');
console.log('🔍 Debug - DB_HOST:', process.env.DB_HOST ? 'LOADED' : 'NOT LOADED');

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = 3001;

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:8080', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

// Database connection
const pool = new Pool({
    user: process.env.DB_USER ? process.env.DB_USER.trim() : undefined, 
    host: process.env.DB_HOST ? process.env.DB_HOST.trim() : undefined,
    database: process.env.DB_NAME ? process.env.DB_NAME.trim() : undefined,
    password: process.env.DB_PASSWORD ? process.env.DB_PASSWORD.trim() : undefined,
    port: parseInt(process.env.DB_PORT || '25060'), 
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
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

// UPDATED: Get filter options with cascading support
app.get('/api/filters', async (req, res) => {
    try {
        const { client, category, month, year } = req.query;

        // Build time filter
        let timeFilter = '';
        const params = [];
        let paramCount = 1;
        
        if (month && year) {
            timeFilter = `WHERE month_name = $${paramCount} AND year_num = $${paramCount + 1}`;
            params.push(month, parseInt(year));
            paramCount += 2;
        } else if (year) {
            timeFilter = `WHERE year_num = $${paramCount}`;
            params.push(parseInt(year));
            paramCount += 1;
        }

        // 1. Get all distinct clients
        const clientsQuery = `
            SELECT DISTINCT client 
            FROM consolidations.data_qperform_weekly 
            ${timeFilter}
            ORDER BY client
        `;
        const clientsResult = await pool.query(clientsQuery, params);
        const clients = clientsResult.rows.map(r => r.client);

        // 2. Get categories (filtered by client if provided)
        let categoriesQuery;
        let categoriesParams = [...params];
        
        if (client) {
            const clientFilter = timeFilter 
                ? `AND client = $${paramCount}` 
                : `WHERE client = $${paramCount}`;
            categoriesParams.push(client);
            
            categoriesQuery = `
                SELECT DISTINCT category 
                FROM consolidations.data_qperform_weekly 
                ${timeFilter} ${clientFilter}
                ORDER BY category
            `;
        } else {
            categoriesQuery = `
                SELECT DISTINCT category 
                FROM consolidations.data_qperform_weekly 
                ${timeFilter}
                ORDER BY category
            `;
        }
        
        const categoriesResult = await pool.query(categoriesQuery, categoriesParams);
        const categories = categoriesResult.rows.map(r => r.category);

        // 3. Get tasks (filtered by client and/or category if provided)
        let tasksQuery;
        let tasksParams = [...params];
        let taskParamCount = paramCount;
        
        if (client && category) {
            const filters = [];
            if (timeFilter) {
                filters.push(timeFilter.replace('WHERE', ''));
            }
            filters.push(`client = $${taskParamCount}`);
            tasksParams.push(client);
            taskParamCount++;
            filters.push(`category = $${taskParamCount}`);
            tasksParams.push(category);
            
            tasksQuery = `
                SELECT DISTINCT task 
                FROM consolidations.data_qperform_weekly 
                WHERE ${filters.join(' AND ')}
                ORDER BY task
            `;
        } else if (client) {
            const clientFilter = timeFilter 
                ? `AND client = $${taskParamCount}` 
                : `WHERE client = $${taskParamCount}`;
            tasksParams.push(client);
            
            tasksQuery = `
                SELECT DISTINCT task 
                FROM consolidations.data_qperform_weekly 
                ${timeFilter} ${clientFilter}
                ORDER BY task
            `;
        } else {
            tasksQuery = `
                SELECT DISTINCT task 
                FROM consolidations.data_qperform_weekly 
                ${timeFilter}
                ORDER BY task
            `;
        }
        
        const tasksResult = await pool.query(tasksQuery, tasksParams);
        const tasks = tasksResult.rows.map(r => r.task);

        // 4. Get months and years
        const monthsQuery = `
            SELECT DISTINCT month_name,
                CASE month_name
                    WHEN 'January' THEN 1
                    WHEN 'February' THEN 2
                    WHEN 'March' THEN 3
                    WHEN 'April' THEN 4
                    WHEN 'May' THEN 5
                    WHEN 'June' THEN 6
                    WHEN 'July' THEN 7
                    WHEN 'August' THEN 8
                    WHEN 'September' THEN 9
                    WHEN 'October' THEN 10
                    WHEN 'November' THEN 11
                    WHEN 'December' THEN 12
                END as month_order
            FROM consolidations.data_qperform_weekly 
            ORDER BY month_order
        `;
        const monthsResult = await pool.query(monthsQuery);
        const months = monthsResult.rows.map(r => r.month_name);

        const yearsQuery = `
            SELECT DISTINCT year_num 
            FROM consolidations.data_qperform_weekly 
            ORDER BY year_num DESC
        `;
        const yearsResult = await pool.query(yearsQuery);
        const years = yearsResult.rows.map(r => r.year_num);

        console.log(`✅ Filters returned: ${clients.length} clients, ${categories.length} categories, ${tasks.length} tasks`);
        
        res.json({
            clients,
            categories,
            tasks,
            months,
            years
        });

    } catch (err) {
        console.error('❌ Error fetching filters:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get monthly summary data (aggregated by client and category)
app.get('/api/monthly-summary', async (req, res) => {
    try {
        const { month, year, category, client, task } = req.query;

        // First get overall totals
        let overallQuery = `
            SELECT
                COUNT(DISTINCT agent_id) as total_aftes,
                COUNT(DISTINCT CASE
                    WHEN flag_qa = 'Critical' OR flag_qa = 'Low'
                    OR flag_prod = 'Critical' OR flag_prod = 'Low'
                    THEN agent_id
                END) as underperformers,
                ROUND(AVG(kpi_qa) * 100, 2) as avg_score
            FROM consolidations.data_qperform_weekly
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (month) {
            overallQuery += ` AND month_name = $${paramCount}`;
            params.push(month);
            paramCount++;
        }

        if (year) {
            overallQuery += ` AND year_num = $${paramCount}`;
            params.push(parseInt(year));
            paramCount++;
        }

        if (category) {
            overallQuery += ` AND category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }

        if (client) {
            overallQuery += ` AND client = $${paramCount}`;
            params.push(client);
            paramCount++;
        }

        if (task) {
            overallQuery += ` AND task = $${paramCount}`;
            params.push(task);
            paramCount++;
        }

        // Get breakdown by client and category
        let detailQuery = `
            SELECT
                client,
                category,
                COUNT(DISTINCT agent_id) as total_aftes,
                ROUND(AVG(kpi_qa) * 100, 2) as avg_score
            FROM consolidations.data_qperform_weekly
            WHERE 1=1
        `;

        const detailParams = [];
        let detailParamCount = 1;

        if (month) {
            detailQuery += ` AND month_name = $${detailParamCount}`;
            detailParams.push(month);
            detailParamCount++;
        }

        if (year) {
            detailQuery += ` AND year_num = $${detailParamCount}`;
            detailParams.push(parseInt(year));
            detailParamCount++;
        }

        if (category) {
            detailQuery += ` AND category = $${detailParamCount}`;
            detailParams.push(category);
            detailParamCount++;
        }

        if (client) {
            detailQuery += ` AND client = $${detailParamCount}`;
            detailParams.push(client);
            detailParamCount++;
        }

        if (task) {
            detailQuery += ` AND task = $${detailParamCount}`;
            detailParams.push(task);
            detailParamCount++;
        }

        detailQuery += ` GROUP BY client, category ORDER BY client, category`;

        const [overallResult, detailResult] = await Promise.all([
            pool.query(overallQuery, params),
            pool.query(detailQuery, detailParams)
        ]);

        console.log(`✅ Retrieved monthly summary - Overall:`, overallResult.rows[0]);
        console.log(`✅ Retrieved ${detailResult.rows.length} detail records`);
        console.log(`🔍 Filters applied: month=${month}, year=${year}, client=${client}, category=${category}, task=${task}`);

        res.json({
            overall: overallResult.rows[0] || { total_aftes: 0, underperformers: 0, avg_score: 0 },
            details: detailResult.rows
        });
    } catch (err) {
        console.error('❌ Error fetching monthly summary:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get client summary data (aggregated by client only)
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

// ACTION LOG
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

// ====================================
// WARNING & RECOMMENDATION ENDPOINTS
// ====================================

const warningEngine = require('./warningEngine');

// Get warnings for an agent
app.get('/api/warnings/:agentEmail', async (req, res) => {
    try {
        const { agentEmail } = req.params;
        const { metricType } = req.query;

        let query = `
            SELECT * FROM consolidations.warnings
            WHERE agent_email = $1
        `;
        const params = [agentEmail];

        if (metricType) {
            query += ` AND metric_type = $2`;
            params.push(metricType);
        }

        query += ` ORDER BY issue_date DESC`;

        const { rows } = await pool.query(query, params);
        console.log(`✅ Retrieved ${rows.length} warnings for ${agentEmail}`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching warnings:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get active warnings for an agent
app.get('/api/warnings/:agentEmail/active', async (req, res) => {
    try {
        const { agentEmail } = req.params;
        const { metricType } = req.query;

        const warnings = await warningEngine.getActiveWarnings(pool, agentEmail, metricType);
        console.log(`✅ Retrieved ${warnings.length} active warnings for ${agentEmail}`);
        res.json(warnings);
    } catch (err) {
        console.error('❌ Error fetching active warnings:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Create a warning
app.post('/api/warnings', async (req, res) => {
    try {
        const warningData = req.body;
        const warningId = await warningEngine.recordWarning(pool, warningData);

        console.log(`✅ Warning ${warningId} created for ${warningData.agentEmail}`);
        res.json({
            success: true,
            warningId: warningId,
            message: 'Warning recorded successfully'
        });
    } catch (err) {
        console.error('❌ Error creating warning:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Generate recommendation for an agent
app.post('/api/recommendations/generate', async (req, res) => {
    try {
        const { agentEmail, metricType, weekStartDate, weekEndDate } = req.body;

        const recommendation = await warningEngine.generateRecommendation(
            pool,
            agentEmail,
            metricType,
            weekStartDate,
            weekEndDate
        );

        console.log(`✅ Generated recommendation for ${agentEmail}: Case ${recommendation.case}`);
        res.json(recommendation);
    } catch (err) {
        console.error('❌ Error generating recommendation:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get recommendations for an agent
app.get('/api/recommendations/:agentEmail', async (req, res) => {
    try {
        const { agentEmail } = req.params;
        const { metricType, actionedOnly } = req.query;

        let query = `
            SELECT * FROM consolidations.recommendations
            WHERE agent_email = $1
        `;
        const params = [agentEmail];
        let paramCount = 2;

        if (metricType) {
            query += ` AND metric_type = $${paramCount}`;
            params.push(metricType);
            paramCount++;
        }

        if (actionedOnly === 'true') {
            query += ` AND is_actioned = true`;
        } else if (actionedOnly === 'false') {
            query += ` AND is_actioned = false`;
        }

        query += ` ORDER BY generated_date DESC`;

        const { rows } = await pool.query(query, params);
        console.log(`✅ Retrieved ${rows.length} recommendations for ${agentEmail}`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching recommendations:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get all unactioned recommendations
app.get('/api/recommendations/unactioned/all', async (req, res) => {
    try {
        const query = `
            SELECT * FROM consolidations.v_unactioned_recommendations
            ORDER BY priority DESC, days_pending DESC
        `;

        const { rows } = await pool.query(query);
        console.log(`✅ Retrieved ${rows.length} unactioned recommendations`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching unactioned recommendations:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Mark recommendation as actioned
app.patch('/api/recommendations/:recommendationId/action', async (req, res) => {
    try {
        const { recommendationId } = req.params;
        const { actionedBy, actionedByEmail, actionNotes } = req.body;

        const query = `
            UPDATE consolidations.recommendations
            SET is_actioned = true,
                actioned_date = CURRENT_DATE,
                actioned_by = $1,
                actioned_by_email = $2,
                action_notes = $3
            WHERE recommendation_id = $4
            RETURNING *
        `;

        const { rows } = await pool.query(query, [actionedBy, actionedByEmail, actionNotes, recommendationId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Recommendation not found' });
        }

        console.log(`✅ Recommendation ${recommendationId} marked as actioned`);
        res.json({ success: true, recommendation: rows[0] });
    } catch (err) {
        console.error('❌ Error updating recommendation:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get at-risk agents
app.get('/api/at-risk-agents', async (req, res) => {
    try {
        const query = `
            SELECT * FROM consolidations.v_at_risk_summary
            ORDER BY risk_level DESC, weeks_underperforming DESC
        `;

        const { rows } = await pool.query(query);
        console.log(`✅ Retrieved ${rows.length} at-risk agents`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching at-risk agents:', err);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
});

// Get leadership reports
app.get('/api/leadership-reports', async (req, res) => {
    try {
        const { leaderEmail, activeOnly } = req.query;

        let query = `
            SELECT * FROM consolidations.leadership_reports
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (leaderEmail) {
            query += ` AND leader_email = $${paramCount}`;
            params.push(leaderEmail);
            paramCount++;
        }

        if (activeOnly === 'true') {
            query += ` AND is_active = true`;
        }

        query += ` ORDER BY issued_date DESC`;

        const { rows } = await pool.query(query, params);
        console.log(`✅ Retrieved ${rows.length} leadership reports`);
        res.json(rows);
    } catch (err) {
        console.error('❌ Error fetching leadership reports:', err);
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