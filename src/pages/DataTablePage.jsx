// src/pages/DataTablePage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import DataTable from '../components/DataTable';
import Papa from 'papaparse';
import { useDatasets } from '../context/DatasetContext';
import { toast } from 'react-toastify';
import { FaFileCsv, FaChartBar } from "react-icons/fa";
import { FiChevronDown, FiUpload } from "react-icons/fi";
import InsightsSidebar from '../components/InsightsSidebar';
import StatisticsSidebar from '../components/StatisticsSidebar';
import '../styles/DataTablePage.css';

const ThemeSelector = ({ theme, setTheme }) => (
    <select className="theme-selector" value={theme} onChange={e => setTheme(e.target.value)}>
        <option value="ag-theme-alpine">Alpine</option>
        <option value="ag-theme-balham">Balham</option>
        <option value="ag-theme-quartz">Quartz</option>
        <option value="ag-theme-material">Material</option>
    </select>
);

const DataTablePage = () => {
    const { datasets, currentDataset, setCurrentDataset } = useDatasets();
    const [rowData, setRowData] = useState([]);
    const [columnDefs, setColumnDefs] = useState([]);
    const [theme, setTheme] = useState('ag-theme-alpine');
    const [error, setError] = useState('');

    // --- Create two separate, independent refs for polling ---
    const statsPollingRef = useRef(null);
    const insightsPollingRef = useRef(null);

    const [statsSidebarState, setStatsSidebarState] = useState('closed');
    const [datasetStatistics, setDatasetStatistics] = useState(null);
    const [isStatsLoading, setIsStatsLoading] = useState(false);
    const [insightsSidebarState, setInsightsSidebarState] = useState('closed');
    const [sidebarColumn, setSidebarColumn] = useState(null);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [isInsightsLoading, setIsInsightsLoading] = useState(false);

    const loadData = useCallback(async () => {
        if (!currentDataset) return;
        try {
            const urlToFetch = `${currentDataset.path}?t=${Date.now()}`;
            const response = await fetch(urlToFetch);
            if (!response.ok) throw new Error('Failed to fetch dataset');
            const csvText = await response.text();
            Papa.parse(csvText, {
                header: true, dynamicTyping: true, skipEmptyLines: true,
                complete: (result) => {
                    if (result.data && result.data.length > 0) {
                        const data = result.data;
                        const headers = Object.keys(data[0]);
                        const newColumnDefs = headers.map(header => ({
                            headerName: header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                            field: header,
                            sortable: true, filter: true, editable: true, enableRowGroup: true,
                        }));
                        setColumnDefs(newColumnDefs);
                        setRowData(data);
                        setError('');
                    } else {
                        setError('No data rows found in CSV');
                        setRowData([]); setColumnDefs([]);
                    }
                },
                error: () => { setError('Failed to parse CSV file.'); }
            });
        } catch (e) { setError('Could not load or process file.'); }
    }, [currentDataset]);

    const fetchDatasetStatistics = useCallback(async () => {
        if (!currentDataset) return;
        if (statsPollingRef.current) clearInterval(statsPollingRef.current);
        setIsStatsLoading(true);
        setDatasetStatistics(null);
        try {
            const response = await fetch(`/api/statistics/${currentDataset.name}`, { method: 'POST' });
            if (!response.ok) throw new Error('Failed to start statistics job.');
            const { job_id } = await response.json();
            statsPollingRef.current = setInterval(async () => {
                const statusResponse = await fetch(`/api/statistics/status/${job_id}`);
                const data = await statusResponse.json();
                if (data.status !== 'PENDING') {
                    clearInterval(statsPollingRef.current);
                    setIsStatsLoading(false);
                    if (data.status === 'SUCCESS') {
                        setDatasetStatistics(data.result);
                    } else {
                        toast.error(data.error || 'Failed to fetch statistics.');
                    }
                }
            }, 3000);
        } catch (err) {
            toast.error(err.message);
            setIsStatsLoading(false);
        }
    }, [currentDataset]);

    const handleRunTask = useCallback(async (taskType, column) => {
        if (!currentDataset) { toast.error("Please select a dataset first."); return; }
        // FIX: Use the correct, dedicated ref for insights polling
        if (insightsPollingRef.current) clearInterval(insightsPollingRef.current);

        if (taskType === 'diagnosis') {
            setSidebarColumn(column);
            setAiAnalysis(null);
            setIsInsightsLoading(true);
            setInsightsSidebarState('open');
            setStatsSidebarState('closed');
        }

        try {
            const response = await fetch('/api/submit_task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataset_name: currentDataset.name,
                    column_name: column.getColId(),
                    task_type: taskType
                }),
            });
            if (!response.ok) throw new Error('Failed to submit job.');
            const { job_id } = await response.json();
            toast.info(`Job submitted for '${column.getColDef().headerName}'.`);

            insightsPollingRef.current = setInterval(async () => {
                const statusResponse = await fetch(`/api/analyze/status/${job_id}`);
                const data = await statusResponse.json();
                if (data.status !== 'PENDING') {
                    clearInterval(insightsPollingRef.current);
                    setIsInsightsLoading(false);
                    setAiAnalysis(data);
                    if (data.status !== 'SUCCESS') {
                        toast.error(`Task failed: ${data.error || "An unknown error occurred."}`);
                    }
                }
            }, 3000);
        } catch (error) {
            toast.error(error.message);
            if (taskType === 'diagnosis') {
                setAiAnalysis({ status: "FAILURE", error: error.message });
                setIsInsightsLoading(false);
            }
        }
    }, [currentDataset, loadData]);

    useEffect(() => {
        if (currentDataset) {
            loadData();
            fetchDatasetStatistics();
        }
        return () => {
            if (statsPollingRef.current) clearInterval(statsPollingRef.current);
            if (insightsPollingRef.current) clearInterval(insightsPollingRef.current);
        };
    }, [currentDataset, loadData, fetchDatasetStatistics]);

    useEffect(() => {
        if (!currentDataset && datasets.length > 0) {
            setCurrentDataset(datasets[0]);
        }
    }, [datasets, currentDataset, setCurrentDataset]);

    const toggleStatsSidebar = () => {
        setStatsSidebarState(s => {
            const newState = s === 'open' ? 'closed' : 'open';
            if (newState === 'open') setInsightsSidebarState('closed');
            return newState;
        });
    };

    const handleDatasetChange = (e) => {
        const selectedFile = datasets.find(d => d.name === e.target.value);
        setCurrentDataset(selectedFile);
    };

    return (
        <div className="page-container" style={{ display: 'flex' }}>
            <div className={`datatable-page-main-content ${statsSidebarState === 'open' ? 'stats-sidebar-open' : ''} ${insightsSidebarState === 'open' ? 'insights-sidebar-open' : ''}`}>
                <header className="page-header animated-component">
                    <div><h1>Data Table</h1><p>Explore and analyze your datasets</p></div>
                    <div className="header-actions">
                        <ThemeSelector theme={theme} setTheme={setTheme} />
                        {datasets.length > 0 && currentDataset ? (
                            <select className="file-selector" value={currentDataset.name} onChange={handleDatasetChange}>
                                {datasets.map(dataset => (<option key={dataset.name} value={dataset.name}>{dataset.name}</option>))}
                            </select>
                        ) : (<p>No datasets available.</p>)}
                    </div>
                </header>
                <div className="dataset-info-bar animated-component" style={{ animationDelay: '0.2s' }}>
                    <div className="file-details">
                        <FaFileCsv />
                        <div>
                            <strong>{currentDataset?.name || 'No file selected'}</strong>
                            <span>{rowData.length} rows &times; {columnDefs.length} columns</span>
                        </div>
                    </div>
                    <div className="header-actions">
                        <button className={`statistics-button ${statsSidebarState === 'open' ? 'active' : ''}`} onClick={toggleStatsSidebar}>
                            <FaChartBar /> Statistics
                        </button>
                        <button className="export-button"><FiUpload /> Export</button>
                    </div>
                </div>
                {error ? (<div className="error-message">{error}</div>) : (
                    <div className='animated-component'>
                        <DataTable
                            rowData={rowData}
                            columnDefs={columnDefs}
                            theme={theme}
                            onRunTask={handleRunTask}
                            onRefresh={loadData}
                        />
                    </div>
                )}
            </div>
            <StatisticsSidebar
                statistics={datasetStatistics}
                isLoading={isStatsLoading}
                sidebarState={statsSidebarState}
                setSidebarState={setStatsSidebarState}
            />
            <InsightsSidebar
                column={sidebarColumn}
                aiAnalysis={aiAnalysis}
                isLoading={isInsightsLoading}
                sidebarState={insightsSidebarState}
                setSidebarState={setInsightsSidebarState}
            />
        </div>
    );
};

export default DataTablePage;