import React, { useState, useMemo } from 'react';
import '../styles/StatisticsSidebar.premium.css'; 
import { 
    FiDatabase, FiTrendingUp, FiShield, FiBarChart2, FiTool, FiTarget, FiZap,
    FiCheckCircle, FiChevronRight 
} from 'react-icons/fi';
import { toast } from 'react-toastify';

const Loader = ({ text = "Calculating Statistics..." }) => (
    <div className="stats-loader-container">
        <div className="stats-loader"></div>
        <p>{text}</p>
    </div>
);

const IntelligentValidationEngine = ({ 
    diagnosticReport, isReportLoading, onGeneratePlans, goal, setGoal, 
    targetVariable, setTargetVariable, arePlansLoading 
}) => {
    
    const numericColumns = useMemo(() =>
        diagnosticReport?.column_diagnostics
            ?.filter(c => ['integer', 'float'].includes(c.data_type))
            .map(c => c.column_name) || [],
    [diagnosticReport]);

    const handleGenerateClick = () => {
        if (!targetVariable) {
            toast.warn("Please select a target variable to generate plans.");
            return;
        }
        onGeneratePlans();
    };
    
    if (isReportLoading) return <Loader text="Loading Diagnostic Report..." />;
    if (!diagnosticReport) return (<div className="no-data-message"><FiBarChart2 size={48} /><p>No diagnostic report available.</p></div>);
    
    return (
        <div className="simulation-controls">
            <h4><FiTool size={18} /> Co-pilot: Intelligent Cleaning</h4>
            <p>Let the AI generate and validate cleaning plans to prepare your data for modeling.</p>
            <div className="control-group">
                <label><FiBarChart2 size={16}/> Modeling Goal</label>
                <select value={goal} onChange={e => setGoal(e.target.value)} disabled={arePlansLoading}>
                    <option value="stable_forecasting">Stable Forecasting</option>
                    <option value="max_performance">Maximize Performance</option>
                </select>
            </div>
            <div className="control-group">
                <label><FiTarget size={16}/> Target Variable (to Predict)</label>
                <select value={targetVariable} onChange={e => setTargetVariable(e.target.value)} disabled={arePlansLoading}>
                    <option value="">Select a numeric column...</option>
                    {numericColumns.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
            </div>
            <button onClick={handleGenerateClick} className="generate-plans-btn" disabled={!targetVariable || arePlansLoading}>
                {arePlansLoading ? (
                    <><div className="small-loader"></div> Generating...</>
                ) : (
                    <><FiZap size={16}/> Generate Treatment Plans</>
                )}
            </button>
        </div>
    );
};

// --- START: NEW COMPONENT TO DISPLAY PLANS ---
const TreatmentPlansDisplay = ({ plans, onRunSimulation }) => {
    // The AI is prompted to return plans with these specific keys.
    const planOrder = ['conservative_plan', 'balanced_plan', 'aggressive_plan'];
    
    // Defensive check to ensure plans object exists and is not empty.
    if (!plans || Object.keys(plans).length === 0) {
        return (
            <div className="error-message">
                <strong>No Plans Generated</strong>
                <p>The AI could not generate treatment plans based on the provided data. This might happen with very clean or very small datasets.</p>
            </div>
        );
    }

    return (
        <div className="treatment-plans-container">
            <h4>AI-Generated Treatment Plans</h4>
            <p className="plans-subtitle">The Co-pilot has generated three strategic plans to prepare your data for modeling.</p>
            <div className="plans-list">
                {planOrder.map(planKey => {
                    const plan = plans[planKey];
                    // If a plan is missing from the response for any reason, skip it gracefully.
                    if (!plan) return null;
                    return (
                        <div key={plan.name} className={`plan-card ${planKey}`}>
                            <div className="plan-header">
                                <h5>{plan.name}</h5>
                                <p>{plan.rationale}</p>
                            </div>
                            <ul className="plan-steps">
                                {plan.steps?.length > 0 ? plan.steps.map((step, index) => ( // Use optional chaining for safety
                                    <li key={index}>
                                        <FiCheckCircle size={14} className="step-icon"/>
                                        <div className="step-details">
                                            <strong>{step.function_name}</strong> on <span>{step.target_columns?.join(', ') || 'Dataset'}</span>
                                            <small>{step.reasoning}</small>
                                        </div>
                                    </li>
                                )) : <li>No cleaning steps required for this plan.</li>}
                            </ul>
                        </div>
                    );
                })}
            </div>
            <button className="simulation-run-btn" onClick={onRunSimulation}>
                <FiChevronRight size={16} /> Run Impact Simulation
            </button>
        </div>
    );
};


const StatisticsSidebar = ({ 
    statistics, isLoading, sidebarState, setSidebarState, sidebarMode,
    diagnosticReport, isReportLoading, goal, setGoal, targetVariable, setTargetVariable,
    arePlansLoading, treatmentPlans, onGeneratePlans, onRunSimulation
}) => {
    const [activeTab, setActiveTab] = useState('overview');

    if (sidebarState === 'closed') {
        return null;
    }

    const renderStatistics = () => {
        if (isLoading) return <Loader />;
        if (!statistics) return (<div className="no-data-message"><FiBarChart2 size={48} /><p>No statistics available.</p></div>);
        
        return (
            <>
                <div className="stats-tabs">
                    <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
                    <button className={`tab-btn ${activeTab === 'columns' ? 'active' : ''}`} onClick={() => setActiveTab('columns')}>Columns</button>
                </div>
                <div className="stats-content-body">
                    {activeTab === 'overview' && (
                        <>
                            <div className="stat-group">
                                <div className="stat-group-header"><FiShield size={16}/> Data Quality</div>
                                <div className="quality-metric">
                                    <span>Overall Quality</span>
                                    <strong>{statistics.qualityScore?.toFixed(1)}%</strong>
                                </div>
                                <div className="progress-bar-container">
                                    <div className="progress-bar" style={{ width: `${statistics.qualityScore}%` }}></div>
                                </div>
                            </div>
                            <div className="stat-group">
                                <div className="stat-group-header"><FiDatabase size={16}/> Dataset Overview</div>
                                <div className="overview-grid">
                                    <div className="overview-grid-item rows"><div className="value">{statistics.rows?.toLocaleString()}</div><div className="label">Rows</div></div>
                                    <div className="overview-grid-item columns"><div className="value">{statistics.columns}</div><div className="label">Columns</div></div>
                                    <div className="overview-grid-item cells"><div className="value">{statistics.totalCells?.toLocaleString()}</div><div className="label">Total Cells</div></div>
                                    <div className="overview-grid-item nulls"><div className="value">{statistics.overallNullCount?.toLocaleString()}</div><div className="label">Null Values</div></div>
                                </div>
                            </div>
                            <div className="stat-group">
                                <div className="stat-group-header"><FiTrendingUp size={16}/> Quick Insights</div>
                                <div className="insight-metric">
                                    <span>Numeric Columns</span>
                                    <strong>{statistics.numericColumnCount}</strong>
                                </div>
                                <div className="insight-metric">
                                    <span>Text Columns</span>
                                    <strong>{statistics.textColumnCount}</strong>
                                </div>
                            </div>
                        </>
                    )}
                    {activeTab === 'columns' && (
                        <div className="columns-tab">
                            {statistics.columnStats?.map((stat) => (
                                <div key={stat.column} className="column-stat-card">
                                    <div className="column-header">
                                        <h5 title={stat.column}>{stat.column}</h5>
                                        <span className={`data-type-badge ${stat.dataType}`}>{stat.dataType}</span>
                                    </div>
                                    <div className="column-details-grid">
                                        <div className="label">Values</div><div className="value">{stat.totalValues?.toLocaleString()}</div>
                                        <div className="label">Unique</div><div className="value">{stat.uniqueValues?.toLocaleString()}</div>
                                        <div className="label">Null</div><div className="value null">{stat.nullCount} ({stat.nullPercentage?.toFixed(1)}%)</div>
                                        
                                        {(stat.dataType === 'integer' || stat.dataType === 'float') && (
                                            <>
                                                <div className="label">Mean</div><div className="value">{stat.mean}</div>
                                                <div className="label">Median</div><div className="value">{stat.median}</div>
                                                <div className="label">Mode</div><div className="value">{stat.mode}</div>
                                            </>
                                        )}
                                    </div>
                                    <div className="column-footer">
                                        <div className="quality-metric">
                                            <span className="label">Data Completeness</span>
                                            <strong>{(100 - stat.nullPercentage).toFixed(1)}%</strong>
                                        </div>
                                        <div className="progress-bar-container">
                                            <div className="progress-bar" style={{ width: `${100 - stat.nullPercentage}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </>
        );
    };

    const renderCoPilot = () => {
        if (arePlansLoading) {
            return (
                <div className="stats-content-body">
                    <Loader text="AI is generating treatment plans..." />
                </div>
            );
        }
        if (treatmentPlans) {
            // CORRECTED: Return TreatmentPlansDisplay without the extra wrapper
            return <TreatmentPlansDisplay plans={treatmentPlans} onRunSimulation={onRunSimulation} />;
        }
        // Default view: show the controls to start the process
        return (
            <div className="stats-content-body">
                <IntelligentValidationEngine 
                    diagnosticReport={diagnosticReport}
                    isReportLoading={isReportLoading}
                    onGeneratePlans={onGeneratePlans}
                    goal={goal}
                    setGoal={setGoal}
                    targetVariable={targetVariable}
                    setTargetVariable={setTargetVariable}
                    arePlansLoading={arePlansLoading}
                />
            </div>
        );
    };

    return (
        <div className={`statistics-sidebar ${sidebarState === 'open' ? 'open' : ''}`}>
            <div className="sidebar-header">
                <h3>{sidebarMode === 'statistics' ? 'Dataset Statistics' : 'Co-pilot Engine'}</h3>
                <button onClick={() => setSidebarState('closed')} className="close-btn">&times;</button>
            </div>
            <div className="sidebar-content">
                {sidebarMode === 'statistics' ? renderStatistics() : renderCoPilot()}
            </div>
        </div>
    );
};
export default StatisticsSidebar;