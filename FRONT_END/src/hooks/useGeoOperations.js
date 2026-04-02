import { useState, useCallback, useRef, useEffect } from 'react';
import { useGeoHistory } from './useGeoHistory';
import { useOverlapOps } from './useOverlapOps';
import { useFeatureEditor } from './useFeatureEditor';

/**
 * useGeoOperations
 * Thin orchestrator composing overlap ops + feature editor into a single hook surface.
 * All heavy logic lives in useOverlapOps and useFeatureEditor.
 */
export const useGeoOperations = (geoJsonData, setGeoJsonData, sessionId, {
    setOverlappedFeatures,
    setOverlapCount,
    setInvolvedCount,
    setIsTiled,
    setGeoJsonBounds,
    incrementMapVersion
} = {}) => {
    const {
        canUndo, canRedo, undo, redo,
        updateHistoryStatus, vertexAbortRef
    } = useGeoHistory(sessionId, setGeoJsonData, { incrementMapVersion });

    const { isCalculating: isOverlapCalc, calculateOverlaps, downloadExcel } = useOverlapOps(
        sessionId, setGeoJsonData,
        { setOverlappedFeatures, setOverlapCount, setInvolvedCount, setIsTiled, setGeoJsonBounds }
    );

    const [isMerging, setIsMerging] = useState(false);
    const isCalculating = isOverlapCalc || isMerging;

    const {
        updateLocalVertex, updateFeatureVertex,
        deleteFeature, mergeFeatures: _mergeFeatures,
        autoMergeAllOverlaps: _autoMerge, exportLayer
    } = useFeatureEditor(geoJsonData, setGeoJsonData, sessionId, {
        updateHistoryStatus, incrementMapVersion, vertexAbortRef
    });

    // Wrap merge + autoMerge to toggle isMerging flag
    const mergeFeatures = useCallback(async (featureIds) => {
        setIsMerging(true);
        try { await _mergeFeatures(featureIds); }
        finally { setIsMerging(false); }
    }, [_mergeFeatures]);

    const autoMergeAllOverlaps = useCallback(async () => {
        setIsMerging(true);
        try { await _autoMerge(); }
        finally { setIsMerging(false); }
    }, [_autoMerge]);

    return {
        isCalculating,
        calculateOverlaps, downloadExcel,
        updateLocalVertex, updateFeatureVertex,
        deleteFeature, mergeFeatures, autoMergeAllOverlaps, exportLayer,
        undo, redo, canUndo, canRedo,
    };
};
