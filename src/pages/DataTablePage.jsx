import React, { useState, useEffect, useCallback, useRef } from 'react';
import DataTable from '../components/DataTable';
import Papa from 'papaparse';
import { useDatasets } from '../context/DatasetContext';
import { toast } from 'react-toastify';
import { FaFileCsv, FaChartBar } from "react-icons/fa";
import { FiChevronDown, FiUpload, FiTool } from "react-icons/fi";
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

const QuickActions = ({ onAction }) => {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (ref.current && !ref.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [ref]);

    const handleSelect = (action) => {
        onAction(action);
        setIsOpen(false);
    };

    return (
        <div className="quick-actions-menu" ref={ref}>
            <button className="quick-actions-button" onClick={() => setIsOpen(o => !o)}>
                <FiTool size={16} />
                Quick Actions
                <FiChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}/>
            </button>
            {isOpen && (
                <div className="quick-actions-dropdown">
                    <button onClick={() => handleSelect('drop_na_rows')}>
                        <strong>Drop Rows with Missing Values</strong>
                        <span>Deletes any row with at least one empty cell.</span>
                    </button>
                    <button onClick={() => handleSelect('drop_duplicate_rows')}>
                        <strong>Drop Duplicate Rows</strong>
                        <span>Deletes all rows that are exact duplicates.</span>
                    </button>
                </div>
            )}
        </div>
    );
};

const DataTablePage = () => {
    const { datasets, currentDataset, setCurrentDataset } = useDatasets();
    const [rowData, setRowData] = useState([]);
    const [columnDefs, setColumnDefs] = useState([]);
    const [theme, setTheme] = useState('ag-theme-alpine');
    const [error, setError] = useState('');

    const statsPollingRef = useRef(null);
    const insightsPollingRef = useRef(null);
    const [activeStatsJobId, setActiveStatsJobId] = useState(null);

    const [datasetSummary, setDatasetSummary] = useState(null);
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
            const summaryResponse = await fetch('/api/datasets/dashboard-summary');
            if (!summaryResponse.ok) throw new Error("Could not fetch dataset summaries.");
            const summaries = await summaryResponse.json();
            const currentSummary = summaries.find(s => s.filename === currentDataset.name);
            setDatasetSummary(currentSummary);

            const urlToFetch = `${currentDataset.path}?t=${Date.now()}`;
            const response = await fetch(urlToFetch);
            if (!response.ok) throw new Error('Failed to fetch dataset');
            const csvText = await response.text();
            
            Papa.parse(csvText, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (result) => {
                    if (result.data && result.data.length > 0) {
                        const data = result.data;
                        const headers = Object.keys(data[0]);
        
                        const newColumnDefs = headers.map(header => ({
                            headerName: header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                            field: header,
                            headerComponentParams: {
                                description: currentSummary?.column_types?.[header] || 'text'
                            },
                            sortable: true,
                            filter: true,
                            editable: true,
                            enableRowGroup: true,
                            ...(headers.indexOf(header) === 0 && { checkboxSelection: true, headerCheckboxSelection: true }),
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
        } catch (e) { setError(e.message || 'Could not load or process the file.'); }
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
            setActiveStatsJobId(job_id);
            statsPollingRef.current = setInterval(async () => {
                const statusResponse = await fetch(`/api/statistics/status/${job_id}`);
                const data = await statusResponse.json();
                
                setActiveStatsJobId(currentActiveJobId => {
                    if (job_id === currentActiveJobId) {
                        if (data.status !== 'PENDING') {
                            clearInterval(statsPollingRef.current);
                            setIsStatsLoading(false);
                            if (data.status === 'SUCCESS') {
                                setDatasetStatistics(data.result);
                            } else {
                                toast.error(data.error || 'Failed to fetch statistics.');
                                setDatasetStatistics(null);
                            }
                        }
                    }
                    return currentActiveJobId;
                });
            }, 3000);
        } catch (err) {
            toast.error(err.message);
            setIsStatsLoading(false);
        }
    }, [currentDataset]);

    const handleRunTask = useCallback(async (taskType, column) => {
        if (!currentDataset) {
            toast.error("Please select a dataset first.");
            return;
        }

        const modificationTasks = ['delete_column', 'impute_mean', 'impute_median', 'impute_mode', 'impute_constant'];
        let taskParams = {};

        if (taskType === 'impute_constant') {
            const customValue = window.prompt("Enter the value to fill missing cells with:", "");
            if (customValue === null) { // User clicked "Cancel"
                return;
            }
            taskParams.value = customValue;
        }

        if (taskType === 'diagnosis') {
            if (insightsPollingRef.current) clearInterval(insightsPollingRef.current);
            setSidebarColumn(column);
            setAiAnalysis(null);
            setIsInsightsLoading(true);
            setInsightsSidebarState('open');
            setStatsSidebarState('closed');
        }

        const toastId = toast.loading(`Submitting task '${taskType}'...`);
        try {
            const response = await fetch('/api/submit_task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataset_name: currentDataset.name,
                    column_name: column.getColId(),
                    task_type: taskType,
                    task_params: taskParams
                }),
            });
            if (!response.ok) throw new Error('Failed to submit job.');
            
            const { job_id } = await response.json();
            toast.update(toastId, { render: `Job '${taskType}' submitted.`, type: 'info', isLoading: false, autoClose: 3000 });

            if (modificationTasks.includes(taskType)) {
                setTimeout(() => {
                    toast.success("Action complete! Refreshing data...");
                    loadData();
                }, 2000); 
                return;
            }

            insightsPollingRef.current = setInterval(async () => {
                const statusResponse = await fetch(`/api/analyze/status/${job_id}`);
                const data = await statusResponse.json();
                if (data.status !== 'PENDING') {
                    clearInterval(insightsPollingRef.current);
                    setIsInsightsLoading(false);
                    setAiAnalysis(data);
                    if (data.status !== 'SUCCESS') {
                        toast.error(`Task failed: ${data.error || "An unknown error occurred."}`);
                    } else {
                        toast.success("AI Analysis complete!");
                    }
                }
            }, 3000);
        } catch (error) {
            toast.update(toastId, { render: error.message, type: 'error', isLoading: false, autoClose: 5000 });
            if (taskType === 'diagnosis') {
                setAiAnalysis({ status: "FAILURE", error: error.message });
                setIsInsightsLoading(false);
            }
        }
    }, [currentDataset, loadData]);

    const handleQuickAction = async (actionType) => {
        if (!currentDataset) {
            toast.warn("Please select a dataset first.");
            return;
        }

        const actionName = actionType === 'drop_na_rows' ? 'drop all rows with missing values' : 'drop all duplicate rows';
        if (!window.confirm(`This will permanently modify the '${currentDataset.name}' file by attempting to ${actionName}. Are you sure you want to continue?`)) {
            return;
        }

        const toastId = toast.loading(`Performing '${actionName}'...`);
        try {
            const response = await fetch('/api/dataset/clean', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataset_name: currentDataset.name,
                    action_type: actionType,
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || "Failed to start cleaning job.");
            }

            const result = await response.json();
            
            setTimeout(() => {
                loadData(); 
                fetchDatasetStatistics();
                toast.update(toastId, { render: "Cleaning successful! Table has been refreshed.", type: "success", isLoading: false, autoClose: 5000 });
            }, 2000);

        } catch (error) {
            toast.update(toastId, { render: error.message, type: "error", isLoading: false, autoClose: 5000 });
        }
    };

    useEffect(() => {
        if (currentDataset) {
            loadData();
            if (statsSidebarState === 'open' || !datasetStatistics) {
                fetchDatasetStatistics();
            }
        }
        return () => {
            if (statsPollingRef.current) clearInterval(statsPollingRef.current);
            if (insightsPollingRef.current) clearInterval(insightsPollingRef.current);
        };
    }, [currentDataset, statsSidebarState, loadData, fetchDatasetStatistics]);

    useEffect(() => {
        if (!currentDataset && datasets.length > 0) {
            setCurrentDataset(datasets[0]);
        }
    }, [datasets, currentDataset, setCurrentDataset]);

    const toggleStatsSidebar = () => {
        const isOpening = statsSidebarState === 'closed';
        if (isOpening) {
            if (!datasetStatistics || datasetStatistics.filename !== currentDataset?.name) {
                fetchDatasetStatistics();
            }
            setInsightsSidebarState('closed');
            setStatsSidebarState('open');
        } else {
            setStatsSidebarState('closed');
        }
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
                        <QuickActions onAction={handleQuickAction} />
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