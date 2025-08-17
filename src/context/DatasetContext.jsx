// src/context/DatasetContext.jsx
import React, { createContext, useState, useContext, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';

const DatasetContext = createContext(null);

export const DatasetProvider = ({ children }) => {
    const [datasets, setDatasets] = useState([]);
    const [currentDataset, setCurrentDataset] = useState(null);
    // Add robust loading and error states
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchInitialDatasets = async () => {
            try {
                // FIX: Update the fetch URL to use the relative, proxy-friendly /api path.
                const response = await fetch('/api/datasets');
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch dataset list. Server responded with ${response.status}.`);
                }
                
                const serverDatasets = await response.json();
                setDatasets(serverDatasets);

                // Automatically select the first dataset if one isn't already selected.
                if (serverDatasets.length > 0 && !currentDataset) {
                    setCurrentDataset(serverDatasets[0]);
                }
            } catch (err) {
                setError(err.message);
                toast.error(err.message);
                setDatasets([]); // Ensure datasets is empty on error
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialDatasets();
        // The empty dependency array [] ensures this runs only once on application startup.
    }, []); // This is correct, no changes needed here.

    const addDataset = (newDataset) => {
        setDatasets(prev => {
            if (prev.some(d => d.name === newDataset.name)) return prev;
            return [...prev, newDataset];
        });
        // Automatically select the newly added dataset
        setCurrentDataset(newDataset);
    };

    // Memoize the context value to prevent unnecessary re-renders of components that use this context.
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