-- QPerform Warning & Recommendation System Database Schema
-- This schema implements the Cases A-E warning and recommendation logic

-- ====================================
-- WARNING HISTORY TABLE
-- Tracks all warnings issued to agents
-- ====================================
CREATE TABLE IF NOT EXISTS consolidations.warning_history (
    warning_id SERIAL PRIMARY KEY,
    agent_id VARCHAR(50) NOT NULL,
    agent_email VARCHAR(255) NOT NULL,
    agent_name VARCHAR(255),
    warning_type VARCHAR(50) NOT NULL, -- 'Verbal', 'Written', 'Coaching'
    warning_subtype VARCHAR(100), -- 'Substandard Work - Production', 'Substandard Work - QA', etc.
    metric_type VARCHAR(20) NOT NULL, -- 'Production' or 'QA'
    issued_by VARCHAR(100) NOT NULL, -- Director/AVP who issued
    issued_by_email VARCHAR(255),
    issued_date DATE NOT NULL,
    expires_date DATE, -- When warning becomes inactive (NULL = never expires)
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    related_week_start DATE, -- Week that triggered this warning
    related_week_end DATE,
    client VARCHAR(255), -- Client associated with the warning
    category VARCHAR(255), -- Category associated with the warning
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Indexes for performance
    INDEX idx_agent_email (agent_email),
    INDEX idx_agent_id (agent_id),
    INDEX idx_issued_date (issued_date),
    INDEX idx_is_active (is_active),
    INDEX idx_metric_type (metric_type),
    INDEX idx_warning_type (warning_type)
);

-- ====================================
-- RECOMMENDATIONS TABLE
-- Tracks generated recommendations for agents and leaders
-- ====================================
CREATE TABLE IF NOT EXISTS consolidations.recommendations (
    recommendation_id SERIAL PRIMARY KEY,
    agent_id VARCHAR(50) NOT NULL,
    agent_email VARCHAR(255) NOT NULL,
    agent_name VARCHAR(255),
    recommendation_type VARCHAR(100) NOT NULL, -- 'Second Verbal Warning', 'Written Warning', etc.
    case_type VARCHAR(10) NOT NULL, -- 'A', 'B', 'C', 'D', 'E'
    metric_type VARCHAR(20) NOT NULL, -- 'Production' or 'QA'
    recommendation_text TEXT NOT NULL, -- Detailed recommendation
    priority VARCHAR(20) DEFAULT 'Medium', -- 'Low', 'Medium', 'High', 'Critical'
    generated_date DATE NOT NULL,
    generated_for_week_start DATE, -- Week that triggered this recommendation
    generated_for_week_end DATE,
    is_actioned BOOLEAN DEFAULT false, -- Has the recommendation been acted upon?
    actioned_date DATE,
    actioned_by VARCHAR(100),
    actioned_by_email VARCHAR(255),
    action_notes TEXT,
    client VARCHAR(255),
    category VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),

    -- Indexes
    INDEX idx_rec_agent_email (agent_email),
    INDEX idx_rec_generated_date (generated_date),
    INDEX idx_rec_is_actioned (is_actioned),
    INDEX idx_rec_case_type (case_type),
    INDEX idx_rec_priority (priority)
);

-- ====================================
-- LEADERSHIP BEHAVIOR REPORTS TABLE
-- Tracks reports issued to leaders for not following procedures
-- ====================================
CREATE TABLE IF NOT EXISTS consolidations.leadership_reports (
    report_id SERIAL PRIMARY KEY,
    leader_id VARCHAR(50) NOT NULL,
    leader_email VARCHAR(255) NOT NULL,
    leader_name VARCHAR(255),
    agent_id VARCHAR(50) NOT NULL, -- Agent who was left unactioned
    agent_email VARCHAR(255) NOT NULL,
    agent_name VARCHAR(255),
    report_type VARCHAR(50) NOT NULL, -- 'First Report', 'Second Report', 'Verbal Warning', 'Written Warning'
    issued_by VARCHAR(100) NOT NULL, -- AVP or higher who issued
    issued_by_email VARCHAR(255),
    issued_date DATE NOT NULL,
    expires_date DATE,
    is_active BOOLEAN DEFAULT true,
    reason TEXT NOT NULL, -- Why the report was issued
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Indexes
    INDEX idx_leader_email (leader_email),
    INDEX idx_leader_issued_date (issued_date),
    INDEX idx_leader_is_active (is_active)
);

-- ====================================
-- AT RISK TRACKING TABLE
-- Tracks agents who are "at risk" based on underperformance patterns
-- ====================================
CREATE TABLE IF NOT EXISTS consolidations.at_risk_agents (
    at_risk_id SERIAL PRIMARY KEY,
    agent_id VARCHAR(50) NOT NULL,
    agent_email VARCHAR(255) NOT NULL,
    agent_name VARCHAR(255),
    metric_type VARCHAR(20) NOT NULL, -- 'Production' or 'QA'
    risk_level VARCHAR(20) NOT NULL, -- 'Low', 'Medium', 'High', 'Critical'
    weeks_underperforming INT NOT NULL, -- Total weeks underperforming
    consecutive_weeks INT NOT NULL, -- Consecutive weeks underperforming
    month_name VARCHAR(20),
    year_num INT,
    last_underperforming_date DATE,
    flagged_date DATE NOT NULL,
    is_resolved BOOLEAN DEFAULT false,
    resolved_date DATE,
    resolved_by VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Indexes
    INDEX idx_atrisk_agent_email (agent_email),
    INDEX idx_atrisk_is_resolved (is_resolved),
    INDEX idx_atrisk_risk_level (risk_level)
);

-- ====================================
-- WARNING EFFECTIVENESS TRACKING
-- Tracks whether warnings lead to improvement
-- ====================================
CREATE TABLE IF NOT EXISTS consolidations.warning_effectiveness (
    effectiveness_id SERIAL PRIMARY KEY,
    warning_id INT REFERENCES consolidations.warning_history(warning_id),
    agent_id VARCHAR(50) NOT NULL,
    agent_email VARCHAR(255) NOT NULL,
    weeks_after_warning INT NOT NULL, -- How many weeks after warning
    performance_improved BOOLEAN, -- Did performance improve?
    new_score NUMERIC(5,4), -- Score in the week being measured
    previous_score NUMERIC(5,4), -- Score before warning
    improvement_percentage NUMERIC(5,2), -- Percentage improvement
    measured_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),

    INDEX idx_effectiveness_warning (warning_id),
    INDEX idx_effectiveness_agent (agent_email)
);

-- ====================================
-- COMMENTS/AUDIT LOG
-- ====================================
COMMENT ON TABLE consolidations.warning_history IS 'Tracks all warnings issued to agents for underperformance';
COMMENT ON TABLE consolidations.recommendations IS 'Auto-generated recommendations based on warning history and underperformance';
COMMENT ON TABLE consolidations.leadership_reports IS 'Behavior reports issued to leaders who fail to follow procedures';
COMMENT ON TABLE consolidations.at_risk_agents IS 'Agents flagged as at-risk based on underperformance patterns';
COMMENT ON TABLE consolidations.warning_effectiveness IS 'Tracks effectiveness of warnings in improving performance';

-- ====================================
-- VIEWS FOR COMMON QUERIES
-- ====================================

-- View: Active warnings by agent
CREATE OR REPLACE VIEW consolidations.v_active_warnings AS
SELECT
    w.*,
    COUNT(*) OVER (PARTITION BY agent_email, metric_type) as total_active_warnings,
    COUNT(CASE WHEN warning_type = 'Verbal' THEN 1 END) OVER (PARTITION BY agent_email, metric_type) as verbal_warnings,
    COUNT(CASE WHEN warning_type = 'Written' THEN 1 END) OVER (PARTITION BY agent_email, metric_type) as written_warnings
FROM consolidations.warning_history w
WHERE is_active = true
    AND (expires_date IS NULL OR expires_date >= CURRENT_DATE);

-- View: Unactioned recommendations
CREATE OR REPLACE VIEW consolidations.v_unactioned_recommendations AS
SELECT
    r.*,
    CURRENT_DATE - r.generated_date as days_pending
FROM consolidations.recommendations r
WHERE is_actioned = false
ORDER BY priority DESC, generated_date ASC;

-- View: At-risk agents summary
CREATE OR REPLACE VIEW consolidations.v_at_risk_summary AS
SELECT
    a.*,
    w.total_active_warnings,
    w.verbal_warnings,
    w.written_warnings
FROM consolidations.at_risk_agents a
LEFT JOIN (
    SELECT
        agent_email,
        metric_type,
        COUNT(*) as total_active_warnings,
        COUNT(CASE WHEN warning_type = 'Verbal' THEN 1 END) as verbal_warnings,
        COUNT(CASE WHEN warning_type = 'Written' THEN 1 END) as written_warnings
    FROM consolidations.warning_history
    WHERE is_active = true
    GROUP BY agent_email, metric_type
) w ON a.agent_email = w.agent_email AND a.metric_type = w.metric_type
WHERE a.is_resolved = false;

-- ====================================
-- SAMPLE DATA (for testing)
-- ====================================
-- Uncomment below to insert sample data

-- INSERT INTO consolidations.warning_history
-- (agent_id, agent_email, agent_name, warning_type, metric_type, issued_by, issued_date, is_active)
-- VALUES
-- ('1431', 'test.agent@onq.global', 'Test Agent', 'Verbal', 'QA', 'Director Name', CURRENT_DATE - INTERVAL '2 weeks', true);
