// src/context/DatasetContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import { toast } from 'react-toastify';

const DatasetContext = createContext();

export const DatasetProvider = ({ children }) => {
  const [datasets, setDatasets] = useState([]);
  // THE FIX - PART 1: The context will now also manage the currently selected dataset.
  const [currentDataset, setCurrentDataset] = useState(null);

  // This effect runs once when the application loads to get the initial file list.
  useEffect(() => {
    const fetchInitialDatasets = async () => {
      try {
        const response = await fetch('http://localhost:8000/datasets');
        if (!response.ok) throw new Error('Could not fetch the list of datasets.');
        
        const serverDatasets = await response.json();
        setDatasets(serverDatasets);

        // Automatically select the first dataset if one isn't already selected.
        if (serverDatasets.length > 0 && !currentDataset) {
          setCurrentDataset(serverDatasets[0]);
        }
      } catch (error) {
        toast.error(error.message);
        setDatasets([]);
      }
    };
    fetchInitialDatasets();
  }, []); // Empty array ensures this runs only once on startup.

  const addDataset = (newDataset) => {
    setDatasets(prev => {
      if (prev.some(d => d.name === newDataset.name)) return prev;
      return [...prev, newDataset];
    });
    // Automatically select the newly added dataset
    setCurrentDataset(newDataset);
  };

  return (
    // THE FIX - PART 2: Provide the currentDataset and its setter to the whole app.
    <DatasetContext.Provider value={{ datasets, addDataset, currentDataset, setCurrentDataset }}>
      {children}
    </DatasetContext.Provider>
  );
};

export const useDatasets = () => useContext(DatasetContext);