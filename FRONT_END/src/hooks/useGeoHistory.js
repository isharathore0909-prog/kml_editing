import { useState, useCallback, useEffect, useRef } from 'react';
import { geoApi } from '../api/geoApi';
import { mutateGeometry } from '../utils/geoUtils';

export const useGeoHistory = (sessionId, setGeoJsonData, { incrementMapVersion } = {}) => {
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const vertexAbortRef = useRef(null);

    // Sync undo/redo status from the server whenever the active session changes.
    useEffect(() => {
        if (!sessionId) {
            setCanUndo(false);
            setCanRedo(false);
            return;
        }
        geoApi.getHistoryStatus(sessionId)
            .then(res => {
                setCanUndo(res.can_undo ?? false);
                setCanRedo(res.can_redo ?? false);
            })
            .catch(() => {
                setCanUndo(false);
                setCanRedo(false);
            });
    }, [sessionId]);

    const updateHistoryStatus = useCallback((res) => {
        if (!res) return;
        if (res.can_undo !== undefined) setCanUndo(res.can_undo);
        if (res.can_redo !== undefined) setCanRedo(res.can_redo);
    }, []);

    const applyDelta = useCallback((actions) => {
        if (!actions) return;
        const actionList = Array.isArray(actions) ? actions : [actions];

        setGeoJsonData(prev => {
            if (!prev) return prev;
            let newFeatures = [...prev.features];

            actionList.forEach(action => {
                const { feature_id, data, type, path, pos } = action;

                if (type === 'update' || type === 'add') {
                    const index = newFeatures.findIndex(f => f._id === feature_id);
                    if (index !== -1) {
                        newFeatures[index] = { ...data, _id: feature_id };
                    } else {
                        newFeatures.push({ ...data, _id: feature_id });
                    }
                } else if (type === 'delete') {
                    newFeatures = newFeatures.filter(f => f._id !== feature_id);
                } else if (type === 'vertex') {
                    const index = newFeatures.findIndex(f => f._id === feature_id);
                    if (index !== -1) {
                        const oldF = newFeatures[index];
                        const newF = { ...oldF, geometry: JSON.parse(JSON.stringify(oldF.geometry)) };
                        if (pos && Array.isArray(pos)) {
                            mutateGeometry(newF.geometry, path, pos);
                        }
                        newFeatures[index] = newF;

                    }
                }
            });

            return { ...prev, features: newFeatures, _v: (prev._v || 0) + 1 };
        });
        if (incrementMapVersion) incrementMapVersion();
    }, [setGeoJsonData, incrementMapVersion]);

    const undo = useCallback(async () => {
        if (vertexAbortRef.current) {
            vertexAbortRef.current.abort();
            vertexAbortRef.current = null;
        }
        try {
            const res = await geoApi.undoHistory(sessionId);
            if (res.action) {
                applyDelta(res.action);
                updateHistoryStatus(res);
            }
        } catch (e) {
            console.warn("No more undo history");
        }
    }, [sessionId, applyDelta, updateHistoryStatus]);

    const redo = useCallback(async () => {
        if (vertexAbortRef.current) {
            vertexAbortRef.current.abort();
            vertexAbortRef.current = null;
        }
        try {
            const res = await geoApi.redoHistory(sessionId);
            if (res.action) {
                applyDelta(res.action);
                updateHistoryStatus(res);
            }
        } catch (e) {
            console.warn("No more redo history");
        }
    }, [sessionId, applyDelta, updateHistoryStatus]);

    return {
        canUndo,
        canRedo,
        undo,
        redo,
        updateHistoryStatus,
        applyDelta,
        vertexAbortRef
    };
};
