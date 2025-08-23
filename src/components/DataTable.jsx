import React, { useRef, useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'ag-grid-community/styles/ag-theme-balham.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-community/styles/ag-theme-material.css';
import '../styles/DataTable.css'; 
import { LuSearch, LuFilter, LuGripVertical } from 'react-icons/lu';

const CustomHeader = props => {
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
                <div className="custom-header-title">{displayName}</div>
                <div className="custom-header-description">{description}</div>
            </div>
            <div ref={menuButtonRef} className="custom-header-menu-button" onClick={onMenuClickHandler}>
                <LuGripVertical size={16} />
            </div>
        </div>
    );
};

const DataTable = ({ rowData, columnDefs, theme, onRunTask, onRefresh }) => {
    const gridRef = useRef(null);

    const onSearch = (event) => {
        if (gridRef.current && gridRef.current.api) {
            gridRef.current.api.setQuickFilter(event.target.value);
        }
    };
  
    const getContextMenuItems = useCallback((params) => {
        const columnType = params.column.getColDef().headerComponentParams?.description;
        const isNumeric = ['integer', 'float', 'identifier'].includes(columnType);
        
        let menuItems = [
            { name: 'Full Column Diagnosis', action: () => onRunTask('diagnosis', params.column), icon: '<span class="ag-icon ag-icon-execute"></span>' },
            'separator',
            { name: 'Delete Column', action: () => { if (confirm(`Delete '${params.column.getColDef().headerName}'?`)) { onRunTask('delete_column', params.column); } }, icon: '<span class="ag-icon ag-icon-delete"></span>' }
        ];

        if (isNumeric) {
            menuItems.push(
                'separator',
                { name: 'Standardize (Z-Score)', action: () => onRunTask('standard_scale', params.column) },
                { name: 'Normalize (0-1 Range)', action: () => onRunTask('minmax_scale', params.column) }
            );
        }
    
        menuItems.push('separator', 'copy', 'paste', 'export');
        return menuItems;
    }, [onRunTask, onRefresh]);

    const defaultColDef = useMemo(() => ({
        resizable: true,
        headerComponent: CustomHeader,
        menuTabs: ['generalMenuTab', 'filterMenuTab', 'columnsMenuTab'],
        minWidth: 120,
        flex: 1,
    }), []);

    return (
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
                    getContextMenuItems={getContextMenuItems}
                    
                    rowDragManaged={true}
                    rowSelection={'multiple'}
                    suppressRowClickSelection={true}
                />
            </div>
        </div>
    );
};

export default DataTable;