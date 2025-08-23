// src/pages/UploadPage.jsx
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { useDatasets } from '../context/DatasetContext';
import { FaFileCsv } from 'react-icons/fa';
import { toast } from 'react-toastify';
import '../styles/UploadPage.css';

const UploadPage = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const { addDataset } = useDatasets();
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);

  // This function is called when files are dropped or selected.
  const onDrop = useCallback(acceptedFiles => {
    // We'll handle one file at a time for a cleaner workflow.
    if (acceptedFiles.length > 0) {
        setSelectedFiles([acceptedFiles[0]]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false, // Ensure only one file can be selected at a time
    accept: {
      'text/csv': ['.csv'],
    }
  });

  // This is the core function that handles the upload to the backend.
  const handleProcessAndUpload = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append("file", selectedFiles[0]);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error((await response.json()).detail || 'File upload failed.');
      
      const result = await response.json();
      
      // THE FIX: Use the new name and path returned by the server.
      addDataset({
        name: result.name, // Use the versioned name from the server
        source: 'uploaded',
        path: result.path,   // Use the versioned path from the server
      });

      toast.success(result.message);
      addDataset(result);
      navigate('/dashboard');

    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    // By wrapping the content, we can apply staggered animations.
    <div className="upload-page-container animated-component">
      <div className="upload-page-header" style={{ animationDelay: '0.1s' }}>
        <h1>Upload Data Files</h1>
        <p className="subtitle">Upload a CSV file to start analyzing your data</p>
      </div>

      <div className="upload-box-wrapper" style={{ animationDelay: '0.2s' }}>
        <div {...getRootProps()} className={`upload-box ${isDragActive ? 'active' : ''}`}>
          <input {...getInputProps()} />
          <div className="upload-box-content">
            <span className="upload-icon">📄</span>
            {isDragActive ?
              <p>Drop the file here ...</p> :
              <p>Drag & drop your file <br/> or click to <span className="browse-link">Choose File</span></p>
            }
            <p className="supported-formats">Supported format: CSV</p>
          </div>
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="selected-files-wrapper animated-component" style={{ animationDelay: '0.3s' }}>
          <h2>Selected File</h2>
          <div className="file-item">
            <FaFileCsv className="file-icon" />
            <div className="file-details">
              <span className="file-name">{selectedFiles[0].name}</span>
              <span className="file-size">{(selectedFiles[0].size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <span className="file-type-badge">CSV</span>
          </div>
          <button onClick={handleProcessAndUpload} disabled={isUploading} className="process-button">
            {isUploading ? 'Uploading...' : 'Process and Upload File'}
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadPage;