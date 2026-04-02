import { useState, useCallback, useRef, useEffect } from 'react';
import { geoApi } from '../api/geoApi';
import { useGeoHistory } from './useGeoHistory';
import { mutateGeometry, getVertexCoord, findOverlapGroups } from '../utils/geoUtils';

/**
 * useGeoOperations - Main hook for geospatial data manipulation tasks.
 * Optimized and modularized to handle history, geometry edits, and bulk actions.
 */
export const useGeoOperations = (geoJsonData, setGeoJsonData, fileName, {
    setOverlappedFeatures,
    setOverlapCount,
    setInvolvedCount,
    setIsTiled,
    setGeoJsonBounds,
    incrementMapVersion
} = {}) => {
    const [isCalculating, setIsCalculating] = useState(false);
    const latestDataRef = useRef(geoJsonData);

    // Delegate history management to specialized hook
    const {
        canUndo, canRedo, undo, redo,
        updateHistoryStatus, applyDelta, vertexAbortRef
    } = useGeoHistory(fileName, setGeoJsonData, { incrementMapVersion });

    useEffect(() => {
        latestDataRef.current = geoJsonData;
    }, [geoJsonData]);

    const calculateOverlaps = useCallback(async (rawFile, explicitFileName, skipOverlaps = false) => {
        if (!rawFile) return;
        const targetFileName = explicitFileName || fileName;
        setIsCalculating(true);
        try {
            const data = await geoApi.calculateOverlaps(rawFile, targetFileName, skipOverlaps);
            setOverlapCount?.(data.overlapCount);
            setInvolvedCount?.(data.involvedCount);
            setIsTiled?.(data.isTiled);

            if (data.isTiled) {
                // For tiled mode, we start with an empty feature set and stream via BBox
                setGeoJsonData({ type: 'FeatureCollection', features: [] });
            }

            if (data.bounds) {
                // Convert [minx, miny, maxx, maxy] to [[miny, minx], [maxy, maxx]] for Leaflet
                const lBounds = [
                    [data.bounds[1], data.bounds[0]],
                    [data.bounds[3], data.bounds[2]]
                ];
                setGeoJsonBounds?.(lBounds);
            }
        } catch (error) {
            console.error("Overlaps calculation failed:", error);
            const msg = error.message?.includes("is not valid JSON")
                ? "Backend returned invalid format. Please check server logs."
                : "Internal Server Error calculating overlaps.";
            alert(msg);
        } finally {
            setIsCalculating(false);
        }
    }, [setOverlappedFeatures, setOverlapCount, setInvolvedCount]);

    const downloadExcel = useCallback(async (rawFile) => {
        if (!rawFile) return;
        try {
            const blob = await geoApi.downloadOverlapExcel(rawFile);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `overlapped_features_${fileName.split('.')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Excel download failed:", error);
        }
    }, [fileName]);

    /**
     * updateLocalVertex - Updates the local GeoJSON state for immediate feedback
     */
    const updateLocalVertex = useCallback((featureId, updatedGeometryParams) => {
        setGeoJsonData(prevData => {
            if (!prevData?.features) return prevData;
            const index = prevData.features.findIndex(f => f._id === featureId);
            if (index === -1) return prevData;

            const newFeatures = [...prevData.features];
            // Cloning specific geometry for better performance than full deep clone
            const targetFeature = { ...newFeatures[index] };
            targetFeature.geometry = JSON.parse(JSON.stringify(targetFeature.geometry));

            mutateGeometry(
                targetFeature.geometry,
                updatedGeometryParams.vertex_path,
                [updatedGeometryParams.new_lng, updatedGeometryParams.new_lat]
            );

            newFeatures[index] = targetFeature;
            return { ...prevData, features: newFeatures, _v: (prevData._v || 0) + 1 };
        });
    }, [setGeoJsonData]);

    /**
     * updateFeatureVertex - Sends vertex update to server and manages aborting concurrent requests
     */
    const updateFeatureVertex = useCallback(async (featureId, updatedGeometryParams) => {
        const currentData = latestDataRef.current;
        if (!currentData) return;
        const featureToUpdate = currentData.features.find(f => f._id === featureId);
        if (!featureToUpdate) return;

        const oldPos = getVertexCoord(featureToUpdate.geometry, updatedGeometryParams.vertex_path);

        // Immediate local update
        updateLocalVertex(featureId, updatedGeometryParams);

        // Manage API request with AbortController
        if (vertexAbortRef.current) vertexAbortRef.current.abort();
        const abortCtrl = new AbortController();
        vertexAbortRef.current = abortCtrl;

        try {
            const data = await geoApi.recordVertexEdit(
                featureId,
                updatedGeometryParams.vertex_path,
                oldPos ? [...oldPos] : null,
                [updatedGeometryParams.new_lng, updatedGeometryParams.new_lat],
                fileName,
                abortCtrl.signal
            );

            if (!abortCtrl.signal.aborted) {
                vertexAbortRef.current = null;
                updateHistoryStatus(data);
                incrementMapVersion?.();
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.warn('recordVertexEdit failed:', error.message);
        }
    }, [updateLocalVertex, fileName, updateHistoryStatus, incrementMapVersion, vertexAbortRef]);

    const exportLayer = useCallback(async (format) => {
        const currentData = latestDataRef.current;
        if (!currentData) return;
        try {
            const baseName = fileName.replace(/\.[^/.]+$/, "");
            const blob = await geoApi.exportLayer(currentData, format, `${baseName}_edited`);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseName}_edited.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Export failed:", error);
        }
    }, [fileName]);

    const deleteFeature = useCallback(async (featureId) => {
        const currentData = latestDataRef.current;
        if (!currentData) return;
        const featureToDelete = currentData.features.find(f => f._id === featureId);
        if (!featureToDelete) return;

        try {
            const res = await geoApi.deleteFeature(featureToDelete, fileName);
            setGeoJsonData(prevData => {
                if (!prevData?.features) return prevData;
                return {
                    ...prevData,
                    features: prevData.features.filter(f => f._id !== featureId),
                    _v: (prevData._v || 0) + 1
                };
            });
            updateHistoryStatus(res);
            incrementMapVersion?.();
        } catch (e) {
            console.error("Failed to delete feature:", e);
        }
    }, [setGeoJsonData, fileName, updateHistoryStatus, incrementMapVersion]);

    const mergeFeatures = useCallback(async (featureIds) => {
        const currentData = latestDataRef.current;
        if (!currentData || !featureIds || featureIds.length < 2) return;

        const featuresToMerge = featureIds.map(id => currentData.features.find(f => f._id === id)).filter(Boolean);
        if (featuresToMerge.length < 2) return;

        try {
            setIsCalculating(true);
            const res = await geoApi.mergeFeatures(featuresToMerge, fileName);

            if (res.merged_feature) {
                setGeoJsonData(prev => {
                    if (!prev) return prev;
                    let newFeatures = prev.features.filter(f => {
                        const fid = f._id || f.id || (f.properties && (f.properties._id || f.properties.id));
                        return !res.deleted_ids.includes(fid);
                    });
                    const index = newFeatures.findIndex(f => (f._id || f.id) === res.merged_feature._id);
                    if (index !== -1) {
                        newFeatures[index] = res.merged_feature;
                    } else {
                        newFeatures.push(res.merged_feature);
                    }
                    return { ...prev, features: newFeatures, _v: (prev._v || 0) + 1 };
                });
                updateHistoryStatus(res);
                incrementMapVersion?.();
            }
        } catch (e) {
            console.error("Merge failed:", e);
            alert("Failed to merge features: " + e.message);
        } finally {
            setIsCalculating(false);
        }
    }, [setGeoJsonData, fileName, updateHistoryStatus, incrementMapVersion]);

    const autoMergeAllOverlaps = useCallback(async () => {
        const currentData = latestDataRef.current;
        if (!currentData?.features) return;

        try {
            setIsCalculating(true);
            const groups = findOverlapGroups(currentData.features);

            if (groups.length === 0) {
                alert("No overlapping features found to merge.");
                return;
            }

            // Merge each group sequentially to avoid backend race conditions/conflicts
            for (const group of groups) {
                await mergeFeatures(Array.from(group));
            }
        } catch (e) {
            console.error("Auto-merge failed:", e);
            alert("Auto-merge failed: " + e.message);
        } finally {
            setIsCalculating(false);
        }
    }, [mergeFeatures]);

    return {
        isCalculating,
        calculateOverlaps,
        downloadExcel,
        updateLocalVertex,
        updateFeatureVertex,
        deleteFeature,
        mergeFeatures,
        autoMergeAllOverlaps,
        exportLayer,
        undo,
        redo,
        canUndo,
        canRedo
    };
};
