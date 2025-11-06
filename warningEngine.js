// warningEngine.js
// Core business logic for the Warning & Recommendation Engine
// Implements Cases A-E from requirements

/**
 * Warning & Recommendation Engine
 *
 * Cases:
 * A: 1 Verbal Warning + underperforms again → Second Verbal Warning + Coaching
 * B: 2 Verbal Warnings + underperforms again → Written Warning
 * C: 2 Written Warnings + underperforms again → Employee Offboarding
 * D: Agent underperforming >2 weeks, NO ACTIONS → Leadership Behavior Report + Verbal Warning
 * E: Leader fails procedures again (within warning period) → Second Report + Written Warning
 */

// ====================================
// CONFIGURATION (needs clarification)
// ====================================

const WARNING_EXPIRATION = {
    'Verbal': 90, // days - NEEDS CONFIRMATION
    'Written': 180, // days - NEEDS CONFIRMATION
    'Coaching': null, // never expires? - NEEDS CONFIRMATION
};

// NEEDS CONFIRMATION: Is "at risk" 3 consecutive weeks OR 3 total weeks in month?
const AT_RISK_THRESHOLD = 3; // weeks
const AT_RISK_MODE = 'consecutive'; // 'consecutive' or 'total'

// NEEDS CONFIRMATION: Does Coaching count as an "Action"?
const COACHING_COUNTS_AS_ACTION = false;

/**
 * Get active warnings for an agent
 * Uses existing warnings table
 */
async function getActiveWarnings(pool, agentEmail, metricType) {
    const query = `
        SELECT * FROM consolidations.warnings
        WHERE agent_email = $1
            AND metric_type = $2
            AND status = 'Active'
            AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
        ORDER BY issue_date DESC
    `;

    const result = await pool.query(query, [agentEmail, metricType]);
    return result.rows;
}

/**
 * Count active warnings by type
 */
function countWarningsByType(warnings, warningType) {
    return warnings.filter(w => w.warning_type === warningType).length;
}

/**
 * Get weeks underperforming for an agent
 */
async function getWeeksUnderperforming(pool, agentEmail, metricType, monthName, yearNum) {
    const query = `
        SELECT COUNT(*) as weeks,
               COUNT(CASE WHEN flag_${metricType.toLowerCase()} IN ('Low', 'Critical') THEN 1 END) as underperforming_weeks
        FROM consolidations.data_qperform_weekly
        WHERE agent_email = $1
            AND month_name = $2
            AND year_num = $3
    `;

    const result = await pool.query(query, [agentEmail, monthName, yearNum]);
    return result.rows[0];
}

/**
 * Check if leader has taken action on an underperforming agent
 * Checks both warnings and action_log tables
 */
async function checkLeaderAction(pool, agentEmail, weekStartDate) {
    // Check if there's any warning or action logged for this agent around this week
    const query = `
        SELECT
            (SELECT COUNT(*) FROM consolidations.warnings
             WHERE agent_email = $1
               AND issue_date >= $2 - INTERVAL '7 days'
               AND issue_date <= $2 + INTERVAL '7 days') +
            (SELECT COUNT(*) FROM consolidations.action_log
             WHERE agent_email = $1
               AND action_date >= $2 - INTERVAL '7 days'
               AND action_date <= $2 + INTERVAL '7 days')
        as action_count
    `;

    const result = await pool.query(query, [agentEmail, weekStartDate]);
    return result.rows[0].action_count > 0;
}

/**
 * CASE A: Second Verbal Warning Path
 * Trigger: 1 Verbal Warning + underperforms again
 * Action: Second Verbal Warning + Coaching/Reinforcement
 */
function evaluateCaseA(warnings) {
    const verbalWarnings = countWarningsByType(warnings, 'Verbal');

    if (verbalWarnings === 1) {
        return {
            case: 'A',
            applies: true,
            recommendation: 'Second Verbal Warning + Coaching/Reinforcement',
            priority: 'Medium',
            details: 'Agent has 1 verbal warning and is underperforming again. Issue second verbal warning and provide coaching.',
        };
    }

    return { applies: false };
}

/**
 * CASE B: Written Warning
 * Trigger: 2 Verbal Warnings + underperforms again
 * Action: Written Warning for "Substandard Work"
 */
function evaluateCaseB(warnings) {
    const verbalWarnings = countWarningsByType(warnings, 'Verbal');

    if (verbalWarnings >= 2) {
        return {
            case: 'B',
            applies: true,
            recommendation: 'Written Warning - Substandard Work',
            priority: 'High',
            details: 'Agent has 2 verbal warnings and is still underperforming. Issue formal written warning for substandard work.',
        };
    }

    return { applies: false };
}

/**
 * CASE C: Employee Offboarding
 * Trigger: 2 Written Warnings + underperforms again
 * Action: Prepare Employee Offboarding
 */
function evaluateCaseC(warnings) {
    const writtenWarnings = countWarningsByType(warnings, 'Written');

    if (writtenWarnings >= 2) {
        return {
            case: 'C',
            applies: true,
            recommendation: 'Prepare Employee Offboarding',
            priority: 'Critical',
            details: 'Agent has 2 written warnings and continues to underperform. Agent is at risk. Prepare for offboarding process.',
        };
    }

    return { applies: false };
}

/**
 * CASE D: Leadership Behavior Report (First)
 * Trigger: Agent underperforming >2 weeks, NO ACTIONS by leader
 * Action: Director provides Leadership Behavior Report to AVP + Verbal Warning
 */
async function evaluateCaseD(pool, agentEmail, leaderEmail, weeksData) {
    // Check if agent has been underperforming for >2 weeks
    const underperformingWeeks = weeksData.filter(w =>
        w.flag_qa === 'Low' || w.flag_qa === 'Critical' ||
        w.flag_prod === 'Low' || w.flag_prod === 'Critical'
    );

    if (underperformingWeeks.length <= 2) {
        return { applies: false };
    }

    // Check if leader has taken ANY action
    const hasActions = await checkLeaderAction(pool, agentEmail, underperformingWeeks[0].start_date);

    if (!hasActions) {
        return {
            case: 'D',
            applies: true,
            recommendation: 'Leadership Behavior Report + Verbal Warning for Leader',
            priority: 'High',
            details: `Agent has been underperforming for ${underperformingWeeks.length} weeks with no documented actions from direct leader. Issue leadership behavior report.`,
            leaderEmail: leaderEmail,
        };
    }

    return { applies: false };
}

/**
 * CASE E: Leadership Written Warning
 * Trigger: Leader fails procedures again (within warning timeframe)
 * Action: Second Leadership Behavior Report + Written Warning
 */
async function evaluateCaseE(pool, leaderEmail) {
    // Check for existing leadership reports
    const query = `
        SELECT * FROM consolidations.leadership_reports
        WHERE leader_email = $1
            AND is_active = true
            AND (expires_date IS NULL OR expires_date >= CURRENT_DATE)
        ORDER BY issued_date DESC
    `;

    const result = await pool.query(query, [leaderEmail]);
    const reports = result.rows;

    if (reports.length >= 1) {
        return {
            case: 'E',
            applies: true,
            recommendation: 'Second Leadership Behavior Report + Written Warning for Leader',
            priority: 'Critical',
            details: 'Leader has failed to follow procedures again within warning period. Issue written warning.',
            leaderEmail: leaderEmail,
        };
    }

    return { applies: false };
}

/**
 * Main function: Generate recommendation for an agent
 */
async function generateRecommendation(pool, agentEmail, metricType, weekStartDate, weekEndDate) {
    try {
        // Get active warnings
        const warnings = await getActiveWarnings(pool, agentEmail, metricType);

        // Evaluate cases in priority order (C > B > A)
        // Case C (most severe) first
        let result = evaluateCaseC(warnings);
        if (result.applies) {
            result.agentEmail = agentEmail;
            result.metricType = metricType;
            result.weekStartDate = weekStartDate;
            result.weekEndDate = weekEndDate;
            return result;
        }

        // Case B
        result = evaluateCaseB(warnings);
        if (result.applies) {
            result.agentEmail = agentEmail;
            result.metricType = metricType;
            result.weekStartDate = weekStartDate;
            result.weekEndDate = weekEndDate;
            return result;
        }

        // Case A
        result = evaluateCaseA(warnings);
        if (result.applies) {
            result.agentEmail = agentEmail;
            result.metricType = metricType;
            result.weekStartDate = weekStartDate;
            result.weekEndDate = weekEndDate;
            return result;
        }

        // If no existing warnings, this is the first underperformance
        return {
            case: 'First',
            applies: true,
            recommendation: 'First Verbal Warning',
            priority: 'Low',
            details: 'Agent is underperforming for the first time. Issue first verbal warning.',
            agentEmail: agentEmail,
            metricType: metricType,
            weekStartDate: weekStartDate,
            weekEndDate: weekEndDate,
        };

    } catch (error) {
        console.error('Error generating recommendation:', error);
        throw error;
    }
}

/**
 * Save recommendation to database
 */
async function saveRecommendation(pool, recommendation) {
    const query = `
        INSERT INTO consolidations.recommendations
        (agent_email, recommendation_type, case_type, metric_type, recommendation_text,
         priority, generated_date, generated_for_week_start, generated_for_week_end)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8)
        RETURNING recommendation_id
    `;

    const values = [
        recommendation.agentEmail,
        recommendation.recommendation,
        recommendation.case,
        recommendation.metricType,
        recommendation.details,
        recommendation.priority,
        recommendation.weekStartDate,
        recommendation.weekEndDate,
    ];

    const result = await pool.query(query, values);
    return result.rows[0].recommendation_id;
}

/**
 * Record a warning using existing warnings table
 */
async function recordWarning(pool, warningData) {
    // Calculate warning_level from warning_type for backwards compatibility
    let warningLevel = 1; // Default to Verbal
    if (warningData.warningType === 'Written') warningLevel = 2;
    else if (warningData.warningType === 'Coaching') warningLevel = 0;

    const expiresDate = warningData.warningType && WARNING_EXPIRATION[warningData.warningType]
        ? new Date(Date.now() + WARNING_EXPIRATION[warningData.warningType] * 24 * 60 * 60 * 1000)
        : null;

    const query = `
        INSERT INTO consolidations.warnings
        (agent_email, action_log_id, warning_level, issue_date, expiration_date, status,
         warning_type, warning_subtype, metric_type, issued_by, notes,
         week_start_date, week_end_date, client, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id
    `;

    const values = [
        warningData.agentEmail,
        warningData.actionLogId || null, // Link to action_log if provided
        warningLevel,
        warningData.issuedDate || new Date(),
        expiresDate,
        'Active',
        warningData.warningType, // 'Verbal', 'Written', 'Coaching'
        warningData.warningSubtype, // e.g., 'Substandard Work - QA'
        warningData.metricType, // 'Production' or 'QA'
        warningData.issuedBy,
        warningData.notes,
        warningData.weekStartDate,
        warningData.weekEndDate,
        warningData.client,
        warningData.category,
    ];

    const result = await pool.query(query, values);
    return result.rows[0].id;
}

module.exports = {
    generateRecommendation,
    saveRecommendation,
    recordWarning,
    getActiveWarnings,
    evaluateCaseA,
    evaluateCaseB,
    evaluateCaseC,
    evaluateCaseD,
    evaluateCaseE,
};
