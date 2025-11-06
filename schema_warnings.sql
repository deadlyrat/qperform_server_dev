-- QPerform Warning & Recommendation System Database Schema
-- This schema implements the Cases A-E warning and recommendation logic
-- Uses existing warnings and action_log tables

-- ====================================
-- EXTEND EXISTING WARNINGS TABLE
-- Add columns to support the recommendation engine
-- ====================================

-- Add new columns to existing warnings table if they don't exist
DO $$
BEGIN
    -- Add warning_type column (Verbal, Written, Coaching)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='warning_type'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN warning_type VARCHAR(50);
        -- Migrate existing data: warning_level 1=Verbal, 2=Written, 3+=Written
        UPDATE consolidations.warnings SET warning_type =
            CASE
                WHEN warning_level = 1 THEN 'Verbal'
                WHEN warning_level >= 2 THEN 'Written'
                ELSE 'Verbal'
            END;
    END IF;

    -- Add metric_type column (Production or QA)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='metric_type'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN metric_type VARCHAR(20) DEFAULT 'QA';
    END IF;

    -- Add warning_subtype column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='warning_subtype'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN warning_subtype VARCHAR(100);
    END IF;

    -- Add issued_by column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='issued_by'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN issued_by VARCHAR(255);
    END IF;

    -- Add notes column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='notes'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN notes TEXT;
    END IF;

    -- Add week reference columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='week_start_date'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN week_start_date DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='week_end_date'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN week_end_date DATE;
    END IF;

    -- Add client and category columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='client'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN client VARCHAR(255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='consolidations' AND table_name='warnings' AND column_name='category'
    ) THEN
        ALTER TABLE consolidations.warnings ADD COLUMN category VARCHAR(255);
    END IF;
END $$;

-- Create indexes on new columns
CREATE INDEX IF NOT EXISTS idx_warnings_warning_type ON consolidations.warnings(warning_type);
CREATE INDEX IF NOT EXISTS idx_warnings_metric_type ON consolidations.warnings(metric_type);
CREATE INDEX IF NOT EXISTS idx_warnings_status ON consolidations.warnings(status);
CREATE INDEX IF NOT EXISTS idx_warnings_issue_date ON consolidations.warnings(issue_date);

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
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for recommendations table
CREATE INDEX IF NOT EXISTS idx_rec_agent_email ON consolidations.recommendations(agent_email);
CREATE INDEX IF NOT EXISTS idx_rec_generated_date ON consolidations.recommendations(generated_date);
CREATE INDEX IF NOT EXISTS idx_rec_is_actioned ON consolidations.recommendations(is_actioned);
CREATE INDEX IF NOT EXISTS idx_rec_case_type ON consolidations.recommendations(case_type);
CREATE INDEX IF NOT EXISTS idx_rec_priority ON consolidations.recommendations(priority);

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
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for leadership_reports table
CREATE INDEX IF NOT EXISTS idx_leader_email ON consolidations.leadership_reports(leader_email);
CREATE INDEX IF NOT EXISTS idx_leader_issued_date ON consolidations.leadership_reports(issued_date);
CREATE INDEX IF NOT EXISTS idx_leader_is_active ON consolidations.leadership_reports(is_active);

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
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for at_risk_agents table
CREATE INDEX IF NOT EXISTS idx_atrisk_agent_email ON consolidations.at_risk_agents(agent_email);
CREATE INDEX IF NOT EXISTS idx_atrisk_is_resolved ON consolidations.at_risk_agents(is_resolved);
CREATE INDEX IF NOT EXISTS idx_atrisk_risk_level ON consolidations.at_risk_agents(risk_level);

-- ====================================
-- WARNING EFFECTIVENESS TRACKING
-- Tracks whether warnings lead to improvement
-- ====================================
CREATE TABLE IF NOT EXISTS consolidations.warning_effectiveness (
    effectiveness_id SERIAL PRIMARY KEY,
    warning_id INT REFERENCES consolidations.warnings(id),
    agent_id VARCHAR(50) NOT NULL,
    agent_email VARCHAR(255) NOT NULL,
    weeks_after_warning INT NOT NULL, -- How many weeks after warning
    performance_improved BOOLEAN, -- Did performance improve?
    new_score NUMERIC(5,4), -- Score in the week being measured
    previous_score NUMERIC(5,4), -- Score before warning
    improvement_percentage NUMERIC(5,2), -- Percentage improvement
    measured_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for warning_effectiveness table
CREATE INDEX IF NOT EXISTS idx_effectiveness_warning ON consolidations.warning_effectiveness(warning_id);
CREATE INDEX IF NOT EXISTS idx_effectiveness_agent ON consolidations.warning_effectiveness(agent_email);

-- ====================================
-- COMMENTS/AUDIT LOG
-- ====================================
COMMENT ON TABLE consolidations.warnings IS 'Tracks all warnings issued to agents for underperformance';
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
FROM consolidations.warnings w
WHERE status = 'Active'
    AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE);

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
    FROM consolidations.warnings
    WHERE status = 'Active'
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
