import React from 'react';
import { FileJson, Upload } from 'lucide-react';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useGeoData } from '../../context/GeoDataContext';

/**
 * The drag-and-drop / click-to-upload zone inside the Sidebar.
 * Fully self-contained — reads context directly so Sidebar stays lean.
 */
export const UploadZone = React.memo(function UploadZone() {
    const { isDragging, setIsDragging, fileInputRef, processFile } = useGeoData();
    const { handleFileChange, handleDragOver, handleDragLeave, handleDrop, openFilePicker } = useFileUpload({
        processFile,
        fileInputRef,
        setIsDragging,
    });

    return (
        <div>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.95rem' }}>
                <Upload size={18} /> Data Import
            </h3>
            <div
                className={`upload-card ${isDragging ? 'dragging' : ''}`}
                onClick={openFilePicker}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ borderColor: isDragging ? '#10b981' : '' }}
            >
                <div className="icon-container">
                    <FileJson size={48} />
                </div>
                <p className="upload-card-title">Drop GeoJSON / KML / KMZ here</p>
                <p className="info-text">or click to browse</p>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".json,.geojson,.kml,.kmz"
                    style={{ display: 'none' }}
                />
            </div>
        </div>
    );
});
