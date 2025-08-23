// src/context/DatasetContext.jsx
import React, { createContext, useState, useContext, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';

const DatasetContext = createContext(null);

export const DatasetProvider = ({ children }) => {
    const [datasets, setDatasets] = useState([]);
    const [currentDataset, setCurrentDataset] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchInitialDatasets = async () => {
            try {
                const response = await fetch('/api/datasets');
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch dataset list. Server responded with ${response.status}.`);
                }
                
                const serverDatasets = await response.json();
                setDatasets(serverDatasets);

                if (serverDatasets.length > 0 && !currentDataset) {
                    setCurrentDataset(serverDatasets[0]);
                }
            } catch (err) {
                setError(err.message);
                toast.error(err.message);
                setDatasets([]); 
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialDatasets();
        
    }, []); 

    const addDataset = (newDataset) => {
        setDatasets(prev => {
            if (prev.some(d => d.name === newDataset.name)) return prev;
            return [...prev, newDataset];
        });
        setCurrentDataset(newDataset);
    };

    const value = useMemo(() => ({
        datasets,
        addDataset,
        currentDataset,
        setCurrentDataset,
        isLoading,
        error
    }), [datasets, currentDataset, isLoading, error]);

    return (
        <DatasetContext.Provider value={value}>
            {children}
        </DatasetContext.Provider>
    );
};

export const useDatasets = () => {
    const context = useContext(DatasetContext);
    if (context === undefined) {
        throw new Error('useDatasets must be used within a DatasetProvider');
    }
    return context;
};