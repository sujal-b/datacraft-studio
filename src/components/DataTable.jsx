// src/components/DataTable.jsx
import React, { useRef, useMemo, useCallback, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import InsightsSidebar from './InsightsSidebar';  
import { toast } from 'react-toastify';

// Core and theme CSS
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'ag-grid-community/styles/ag-theme-balham.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-community/styles/ag-theme-material.css';

import '../styles/DataTable.css'; 
import { LuSearch, LuFilter, LuGripVertical } from 'react-icons/lu';

// Custom header component for column titles and menus
const CustomHeader = props => {

  // The 'displayName' prop holds the column title like "Customer ID"
  const { displayName, description, showColumnMenu } = props;
  const menuButtonRef = useRef(null);

  const onMenuClickHandler = (e) => {
    e.stopPropagation();
    if (showColumnMenu) {
      showColumnMenu(menuButtonRef.current);
    }
  };

  return (
    <div className="custom-header-content">
      <div className="custom-header-label">
        {/* We render both the title and the description */}
        <div className="custom-header-title">{displayName}</div>
        <div className="custom-header-description">{description}</div>
      </div>
      <div ref={menuButtonRef} className="custom-header-menu-button" onClick={onMenuClickHandler}>
        <LuGripVertical size={16} />
      </div>
    </div>
  );
};

// Main DataTable component
const DataTable = ({ rowData, columnDefs,setColumnDefs, theme, currentDataset, onRefresh }) => {
  const gridRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  // --- NEW State for the sidebar ---
  const [sidebarState, setSidebarState] = useState('closed');
  const [sidebarColumn, setSidebarColumn] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const onSearch = (event) => {
    if (gridRef.current && gridRef.current.api) {
      gridRef.current.api.setQuickFilter(event.target.value);
    }
  };
  
  const handleBackendTask = async (task) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Only open the sidebar for tasks that require it (like diagnosis)
    if (task.task_type === 'diagnosis') {
        setSidebarColumn(task.column);
        setAiAnalysis(null);
        setIsLoading(true);
        setSidebarState('open');
    }

    try {
      const response = await fetch('http://localhost:8000/submit_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_name: currentDataset.name,
          column_name: task.column.getColId(),
          task_type: task.task_type
        }),
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to submit job.');
      }
      const { job_id } = await response.json();
      toast.info(`Job submitted for '${task.column.getColDef().headerName}'. Processing...`);

      pollingIntervalRef.current = setInterval(async () => {
        const statusResponse = await fetch(`http://localhost:8000/analyze/status/${job_id}`);
        const data = await statusResponse.json();

        if (data.status !== 'PENDING') {
          clearInterval(pollingIntervalRef.current);

          if (data.status === 'SUCCESS') {
            // A professional, maintainable list of all tasks that modify data
            const modificationTasks = ['standard_scale', 'minmax_scale', 'delete_column'];

            if (task.task_type === 'diagnosis') {
              setAiAnalysis(data);
              setIsLoading(false);
            } else if (modificationTasks.includes(task.task_type)) {
              // THE FIX: This now correctly calls onRefresh for all modification tasks.
              toast.success(data.result.message || `${task.task_type} completed!`);
              onRefresh(task.task_type);
            }
          } else { // Handle FAILURE or HALTED
            const errorMessage = data.message || data.error || "An unknown error occurred.";
            toast.error(`Task failed: ${errorMessage}`);
            setAiAnalysis(data);
            setIsLoading(false);
          }
        }
      }, 3000);
    } catch (error) {
      toast.error(error.message);
      setAiAnalysis({ status: "Error", message: error.message });
      setIsLoading(false);
    }
  };

  // --- UPDATED Context Menu to include "Insights" ---
  const getContextMenuItems = useCallback((params) => {
    const isNumeric = ['integer', 'float', 'identifier'].includes(params.column.getColDef().headerComponentParams?.description);
    
    let menuItems = [
      {
        name: 'Run Full Column Diagnosis',
        action: () => handleBackendTask({ task_type: 'diagnosis', column: params.column }),
        icon: '<span class="ag-icon ag-icon-execute"></span>',
      },
      'separator',
      {
        name: 'Delete Column',
        action: () => {
          if (confirm(`Are you sure you want to permanently delete '${params.column.getColDef().headerName}'?`)) {
            handleBackendTask({ task_type: 'delete_column', column: params.column });
          }
        },
        icon: '<span class="ag-icon ag-icon-delete"></span>',
      }
    ];

    if (isNumeric) {
      menuItems.push(
        'separator',
        { name: 'Standardize (Z-Score)', action: () => handleBackendTask({ task_type: 'standard_scale', column: params.column }), icon: '...' },
        { name: 'Normalize (0-1 Range)', action: () => handleBackendTask({ task_type: 'minmax_scale', column: params.column }), icon: '...' },
      );
    }
    
    menuItems.push('separator', 'copy', 'paste', 'export');
    return menuItems;
  }, [rowData, currentDataset, onRefresh, setColumnDefs]);

  const defaultColDef = useMemo(() => ({
    resizable: true,
    headerComponent: CustomHeader,
    menuTabs: ['generalMenuTab', 'filterMenuTab', 'columnsMenuTab'],
    minWidth: 120,
    flex: 1,
  }), []);

  return (
    <>
      <div className="datatable-wrapper">
        <div className="table-controls">
            <div className="search-bar">
                <LuSearch />
                <input type="text" placeholder="Search data..." onChange={onSearch} />
            </div>
            <button className="filter-button">
                <LuFilter />
                All columns
            </button>
        </div>

        <div className={`${theme} ag-custom-theme`} style={{ height: 700, width: '100%' }}>
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            pagination={true}
            paginationPageSize={50}
            headerHeight={56}
            paginationPageSizeSelector={[50,100,150,200]}
            sideBar={true}
            cellSelection={true}
            rowGroupPanelShow={'always'}
            getContextMenuItems={getContextMenuItems}
          />
        </div>
      </div>
      
      {sidebarState !== 'closed' && (
        <InsightsSidebar 
          column={sidebarColumn} 
          aiAnalysis={aiAnalysis}
          isLoading={isLoading}
          sidebarState={sidebarState}
          setSidebarState={setSidebarState} 
        />
      )}
    </>
  );
};

export default DataTable;