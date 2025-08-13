// src/pages/DataTablePage.jsx
import React, { useState, useEffect ,useCallback } from 'react';
import DataTable from '../components/DataTable';
import Papa from 'papaparse';
import { useDatasets } from '../context/DatasetContext'; // Import the custom hook
import { FaFileCsv } from "react-icons/fa";
import { FiChevronDown, FiUpload } from "react-icons/fi";

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


  const loadData = useCallback(async (isNewHistoryPoint = true, operationName = 'Load Dataset') => {
      if (!currentDataset) return;
    
      try {
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
            
            const newColumnDefs = headers.map(header => {
              // --- Professional-grade data type detection in JavaScript ---
              const clean_sample = data.map(row => row[header]).filter(v => v !== null && v !== undefined && v !== '');
              let detected_type = 'text';

              if (clean_sample.length > 0) {
                  const is_numeric_sample = clean_sample.every(v => typeof v === 'number');
                  
                  if (is_numeric_sample) {
                      // 👇 THE IMPROVEMENT IS HERE
                      // Check if all numbers in the sample are whole numbers
                      const is_integer_sample = clean_sample.every(v => Number.isInteger(v));
                      if (is_integer_sample) {
                          // Check for high cardinality to classify as identifier
                          if (new Set(clean_sample).size > 50) {
                              detected_type = 'identifier';
                          } else {
                              detected_type = 'integer';
                          }
                      } else {
                          detected_type = 'float';
                      }
                  } else {
                      // Fallback checks for other types
                      const is_date_sample = clean_sample.every(v => (typeof v === 'string' && v.match(/\d{2,4}[-/]\d{1,2}[-/]\d{1,2}/)));
                      const unique_ratio = new Set(clean_sample).size / clean_sample.length;

                      if (is_date_sample) {
                          detected_type = 'date';
                      } else if (unique_ratio < 0.05 && new Set(clean_sample).size > 1) {
                          detected_type = 'categorical';
                      }
                  }
              }

              return {
                headerName: header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                field: header,
                // Use the new, robustly detected data type for display
                headerComponentParams: { description: detected_type }, 
                sortable: true, filter: true, editable: true, enableRowGroup: true,
              };
            });

            setColumnDefs(newColumnDefs);
            setRowData(data);
            setError('');
          } else {
            // ... (error handling)
            setError('No data found in the CSV file.');
          }
        },
          error: () => {setError('Failed to parse CSV file.')}
        });
      } catch (e) {
        setError('Could not load or process the file.');
      }
  }, [currentDataset, setRowData, setColumnDefs]);

  useEffect(() => {
      // When the component loads, or datasets list changes, ensure currentDataset is valid
      if (!currentDataset && datasets.length > 0) {
        setCurrentDataset(datasets[0]);
      }
    }, [datasets, currentDataset]);

  useEffect(() => {
      loadData(); // Load data whenever loadData changes
  }, [loadData]); 

  const handleDatasetChange = (e) => {
    const selectedFile = datasets.find(d => d.name === e.target.value);
    setCurrentDataset(selectedFile);
  };

  return (
    <div className="page-container">
      <header className="page-header animated-component">
        <div>
          <h1>Data Table</h1>
          <p>Explore and analyze your datasets</p>
        </div>
        <div className="header-actions">
          <ThemeSelector theme={theme} setTheme={setTheme} />
          {datasets.length > 0 ? (
            <select className="file-selector" value={currentDataset?.name} onChange={handleDatasetChange}>
              {datasets.map(dataset => (
                <option key={dataset.name} value={dataset.name}>
                  {dataset.name}
                </option>
              ))}
            </select>
          ) : (
            <p>No datasets available. Please upload a file.</p>
          )}
        </div>
      </header>
      
      <div className="dataset-info-bar animated-component"
      style={{ animationDelay: '0.2s' }}>
        <div className="file-details">
          <FaFileCsv />
          <div>
            <strong>{currentDataset?.name || 'No file selected'}</strong>
            <span>{rowData.length} rows &times; {columnDefs.length} columns</span>
          </div>
        </div>
        <button className="export-button">
          <FiUpload />
          Export
        </button>
      </div>

      {error ? (
        <div className="error-message">{error}</div>
      ) : (
        <div className='animated-component'>
          <DataTable 
          rowData={rowData} 
          columnDefs={columnDefs} 
          setColumnDefs={setColumnDefs}
          theme={theme}
          currentDataset={currentDataset}
          onRefresh={loadData}
          />
        </div>
      )}
    </div>
  );
};

export default DataTablePage;