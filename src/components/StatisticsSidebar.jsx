// src/components/StatisticsSidebar.jsx
import React, { useState } from 'react';
import '../styles/StatisticsSidebar.premium.css'; 
import { FiChevronRight, FiChevronLeft, FiDatabase, FiTrendingUp, FiShield, FiBarChart2 } from 'react-icons/fi';

const Loader = () => (
    <div className="stats-loader-container">
        <div className="stats-loader"></div>
        <p>Calculating Statistics...</p>
    </div>
);

const StatisticsSidebar = ({ statistics, isLoading, sidebarState, setSidebarState }) => {
    const [activeTab, setActiveTab] = useState('overview');
    const handleToggle = () => {
        setSidebarState(prevState => (prevState === 'open' ? 'closed' : 'open'));
    };
    if (sidebarState === 'closed') {
        return null;
    }
    return (
        <div className={`statistics-sidebar ${sidebarState === 'open' ? 'open' : ''}`}>
            <div className="sidebar-header">
                <h3>Dataset Statistics</h3>
            </div>
            <div className="sidebar-content">
                {isLoading && <Loader />}
                {!isLoading && statistics && (
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
                                            <strong>{statistics.dataQuality?.toFixed(1)}%</strong>
                                        </div>
                                        <div className="progress-bar-container">
                                            <div className="progress-bar" style={{ width: `${statistics.dataQuality}%` }}></div>
                                        </div>
                                    </div>
                                    <div className="stat-group">
                                        <div className="stat-group-header"><FiDatabase size={16}/> Dataset Overview</div>
                                        <div className="overview-grid">
                                            <div className="overview-grid-item rows"><div className="value">{statistics.totalRows?.toLocaleString()}</div><div className="label">Rows</div></div>
                                            <div className="overview-grid-item columns"><div className="value">{statistics.totalColumns}</div><div className="label">Columns</div></div>
                                            <div className="overview-grid-item cells"><div className="value">{statistics.totalCells?.toLocaleString()}</div><div className="label">Total Cells</div></div>
                                            <div className="overview-grid-item nulls"><div className="value">{statistics.overallNullCount?.toLocaleString()}</div><div className="label">Null Values</div></div>
                                        </div>
                                    </div>
                                    <div className="stat-group">
                                        <div className="stat-group-header"><FiTrendingUp size={16}/> Quick Insights</div>
                                        <div className="insight-metric">
                                            <span>Numeric Columns</span>
                                            <strong>{statistics.columnStats?.filter(stat => stat.dataType === 'Numeric').length}</strong>
                                        </div>
                                        <div className="insight-metric">
                                            <span>Text Columns</span>
                                            <strong>{statistics.columnStats?.filter(stat => stat.dataType === 'Text').length}</strong>
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
                                                {stat.dataType === 'Numeric' && (
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
                )}
                {!isLoading && !statistics && (<div className="no-data-message"><FiBarChart2 size={48} /><p>No statistics available.</p></div>)}
            </div>
        </div>
    );
};
export default StatisticsSidebar;