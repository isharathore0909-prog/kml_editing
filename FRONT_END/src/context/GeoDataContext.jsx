import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useGeoOperations } from '../hooks/useGeoOperations';
import { transformCoordinates } from '../utils/geoUtils';

const GeoDataContext = createContext(null);

export function GeoDataProvider({ children }) {
    // ── File / data state ──────────────────────────────────────────────────
    const [geoJsonData, setGeoJsonData] = useState(null);
    const [originalData, setOriginalData] = useState(null);
    const [fileName, setFileName] = useState('');
    const [rawFile, setRawFile] = useState(null);

    // ── UI / status state ──────────────────────────────────────────────────
    const [isDragging, setIsDragging] = useState(false);
    const [coordinateStatus, setCoordinateStatus] = useState({ type: 'IDLE', message: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');

    // ── Geo analysis results ───────────────────────────────────────────────
    const [geoJsonBounds, setGeoJsonBounds] = useState(null);
    const [overlapCount, setOverlapCount] = useState(null);
    const [involvedCount, setInvolvedCount] = useState(null);
    const [overlappedFeatures, setOverlappedFeatures] = useState([]);
    const [mapVersion, setMapVersion] = useState(0);
    const [isTiled, setIsTiled] = useState(false);

    const incrementMapVersion = useCallback(() => setMapVersion(v => v + 1), []);

    // ── Tool state ─────────────────────────────────────────────────────────
    const [toolMode, setToolMode] = useState('view');
    const [editingFeatureId, setEditingFeatureId] = useState(null);
    const [mergeSelection, setMergeSelection] = useState([]);

    const fileInputRef = useRef(null);
    const workerRef = useRef(null);

    // Wire up the geo-operations hook
    const geoOps = useGeoOperations(geoJsonData, setGeoJsonData, fileName, {
        setOverlappedFeatures,
        setOverlapCount,
        setInvolvedCount,
        setIsTiled,
        setGeoJsonBounds,
        incrementMapVersion,
    });

    // ── Web Worker for heavy file parsing ─────────────────────────────────
    useEffect(() => {
        const worker = new Worker(new URL('../utils/geoWorker.js', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (e) => {
            if (e.data.type === 'STATUS') {
                setLoadingMessage(e.data.message);
                return;
            }
            if (e.data.type === 'SUCCESS') {
                const {
                    originalData: orig,
                    finalData,
                    msg,
                    statusType,
                    bounds,
                    overlapCount: oCount,
                    involvedCount: iCount,
                    overlappedFeatures: oFeats,
                } = e.data.result;

                setOriginalData(orig);
                setGeoJsonData(finalData);
                setCoordinateStatus({ type: statusType, message: msg });
                setGeoJsonBounds(bounds ?? null);
                // Only accept pre-computed overlap data if it's the richer server version
                setOverlappedFeatures(prev =>
                    (prev?.length > 0 && prev[0]['Overlap Area (sqm)']) ? prev : (oFeats || [])
                );
                setOverlapCount(prev => prev ?? oCount ?? null);
                setInvolvedCount(prev => prev ?? iCount ?? null);
                setIsLoading(false);
            } else {
                setIsLoading(false);
                setCoordinateStatus({ type: 'ERROR', message: 'Failed to parse file.' });
            }
        };

        return () => worker.terminate();
    }, []);

    // ── File processing ───────────────────────────────────────────────────
    const processFile = useCallback((file) => {
        const name = file.name.toLowerCase();
        if (!['.json', '.geojson', '.kml', '.kmz'].some(ext => name.endsWith(ext))) {
            alert('Please upload a .json, .geojson, .kml, or .kmz file');
            return;
        }
        setRawFile(file);
        setIsLoading(true);
        setFileName(file.name);
        setGeoJsonData(null);
        setGeoJsonBounds(null);
        setOverlapCount(null);
        setInvolvedCount(null);
        setOverlappedFeatures([]);
        const THRESHOLD = 30 * 1024 * 1024; // 30MB
        if (file.size > THRESHOLD) {
            setLoadingMessage('Large file detected. Streaming from server...');
            setCoordinateStatus({ type: 'INFO', message: 'Tiled mode: Streaming from server' });

            // Await the server-side tiling and overlap calculation (skipping overlaps initially)
            geoOps.calculateOverlaps(file, file.name, true).finally(() => {
                setIsLoading(false);
            });
        } else {
            setCoordinateStatus({ type: 'IDLE', message: 'Processing visuals…' });
            setLoadingMessage('Loading map data…');
            workerRef.current?.postMessage({ file, name: file.name });
            // Worker will eventually trigger setGeoJsonData which should clear Loading elsewhere
            // but for safety we can clear if worker fails or takes too long.
        }
    }, [geoOps]);

    const handleFileUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (file) processFile(file);
    }, [processFile]);

    // ── Coordinate helpers ────────────────────────────────────────────────
    const toggleManualSwap = useCallback(() => {
        if (!geoJsonData) return;
        const newData = transformCoordinates(geoJsonData, (c) => [c[1], c[0]]);
        setGeoJsonData(newData);
        if (geoJsonBounds) {
            setGeoJsonBounds([
                [geoJsonBounds[0][1], geoJsonBounds[0][0]],
                [geoJsonBounds[1][1], geoJsonBounds[1][0]],
            ]);
        }
        setCoordinateStatus({ type: 'WARNING', message: 'Coordinates manually swapped.' });
    }, [geoJsonData, geoJsonBounds]);

    const resetToOriginal = useCallback(() => {
        if (originalData) {
            setGeoJsonData(JSON.parse(JSON.stringify(originalData)));
            setOverlapCount(null);
            setOverlappedFeatures([]);
        }
    }, [originalData]);

    const clearData = useCallback(() => {
        setGeoJsonData(null);
        setGeoJsonBounds(null);
        setOverlapCount(null);
        setInvolvedCount(null);
        setOverlappedFeatures([]);
        setFileName('');
        setRawFile(null);
        setCoordinateStatus({ type: 'IDLE', message: '' });
        setEditingFeatureId(null);
        setMergeSelection([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    // ── Memoized context value — only changes when relevant state changes ──
    const value = useMemo(() => ({
        // Data
        geoJsonData, setGeoJsonData,
        originalData,
        fileName, setFileName,
        rawFile, setRawFile,
        // UI
        isDragging, setIsDragging,
        coordinateStatus, setCoordinateStatus,
        isLoading, setIsLoading,
        loadingMessage, setLoadingMessage,
        // Geo results
        geoJsonBounds, setGeoJsonBounds,
        overlapCount, setOverlapCount,
        involvedCount, setInvolvedCount,
        overlappedFeatures, setOverlappedFeatures,
        mapVersion, incrementMapVersion,
        isTiled, setIsTiled,
        // Tool mode
        toolMode, setToolMode,
        editingFeatureId, setEditingFeatureId,
        mergeSelection, setMergeSelection,
        // Refs
        fileInputRef,
        // Actions
        processFile,
        handleFileUpload,
        toggleManualSwap,
        resetToOriginal,
        clearData,
        // Geo operations (spread last so they can be overridden if needed)
        ...geoOps,
    }), [
        geoJsonData, originalData, fileName, rawFile,
        isDragging, coordinateStatus, isLoading, loadingMessage,
        geoJsonBounds, overlapCount, involvedCount, overlappedFeatures,
        mapVersion, isTiled,
        toolMode, editingFeatureId, mergeSelection,
        processFile, handleFileUpload, toggleManualSwap, resetToOriginal, clearData,
        geoOps,
    ]);

    return <GeoDataContext.Provider value={value}>{children}</GeoDataContext.Provider>;
}

export function useGeoData() {
    const context = useContext(GeoDataContext);
    if (!context) throw new Error('useGeoData must be used within a GeoDataProvider');
    return context;
}
