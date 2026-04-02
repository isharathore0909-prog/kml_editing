import React from 'react';
import { useGeoData } from '../../context/GeoDataContext';

export function MapOverlay() {
    const { isLoading, fileName, loadingMessage } = useGeoData();

    if (!isLoading) return null;

    return (
        <div className="loading-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(26, 71, 49, 0.88)', zIndex: 9999,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            color: 'white', backdropFilter: 'blur(10px)'
        }}>
            <div className="spinner" style={{
                width: '64px', height: '64px', border: '4px solid rgba(116, 198, 157, 0.2)',
                borderTop: '4px solid #74c69d', borderRadius: '50%', animation: 'spin 1s linear infinite'
            }}></div>
            <h2 style={{ marginTop: '28px' }}>Processing {fileName}...</h2>
            <p>{loadingMessage || "Analyzing geospatial data..."}</p>
        </div>
    );
}
