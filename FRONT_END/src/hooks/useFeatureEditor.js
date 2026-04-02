import { useCallback, useRef, useEffect } from 'react';
import { geoApi } from '../api/geoApi';
import { mutateGeometry, getVertexCoord } from '../utils/geometryOps';
import { findOverlapGroups } from '../utils/spatialIndex';

/**
 * useFeatureEditor
 * Handles all feature mutation: vertex edits, deletion, merge, export.
 */
export const useFeatureEditor = (
    geoJsonData, setGeoJsonData, sessionId,
    { updateHistoryStatus, incrementMapVersion, vertexAbortRef } = {}
) => {
    const latestDataRef = useRef(geoJsonData);
    useEffect(() => { latestDataRef.current = geoJsonData; }, [geoJsonData]);

    // ── Local vertex update (immediate UI feedback) ───────────────────────
    const updateLocalVertex = useCallback((featureId, params) => {
        setGeoJsonData(prev => {
            if (!prev?.features) return prev;
            const idx = prev.features.findIndex(f => f._id === featureId);
            if (idx === -1) return prev;
            const newFeatures = [...prev.features];
            const feat = { ...newFeatures[idx] };
            feat.geometry = JSON.parse(JSON.stringify(feat.geometry));
            mutateGeometry(feat.geometry, params.vertex_path, [params.new_lng, params.new_lat]);
            newFeatures[idx] = feat;
            return { ...prev, features: newFeatures, _v: (prev._v || 0) + 1 };
        });
    }, [setGeoJsonData]);

    // ── Vertex edit with server sync ──────────────────────────────────────
    const updateFeatureVertex = useCallback(async (featureId, params) => {
        const data = latestDataRef.current;
        if (!data) return;
        const feature = data.features.find(f => f._id === featureId);
        if (!feature) return;

        const oldPos = getVertexCoord(feature.geometry, params.vertex_path);
        updateLocalVertex(featureId, params);

        if (vertexAbortRef?.current) vertexAbortRef.current.abort();
        const ctrl = new AbortController();
        if (vertexAbortRef) vertexAbortRef.current = ctrl;

        try {
            const res = await geoApi.recordVertexEdit(
                featureId, params.vertex_path,
                oldPos ? [...oldPos] : null,
                [params.new_lng, params.new_lat],
                sessionId, ctrl.signal
            );
            if (!ctrl.signal.aborted) {
                if (vertexAbortRef) vertexAbortRef.current = null;
                updateHistoryStatus?.(res);
                incrementMapVersion?.();
            }
        } catch (e) {
            if (e.name !== 'AbortError') console.warn('recordVertexEdit failed:', e.message);
        }
    }, [updateLocalVertex, sessionId, updateHistoryStatus, incrementMapVersion, vertexAbortRef]);

    // ── Delete feature ────────────────────────────────────────────────────
    const deleteFeature = useCallback(async (featureId) => {
        const data = latestDataRef.current;
        const feature = data?.features.find(f => f._id === featureId);
        if (!feature) return;
        try {
            const res = await geoApi.deleteFeature(feature, sessionId);
            setGeoJsonData(prev => ({
                ...prev,
                features: prev.features.filter(f => f._id !== featureId),
                _v: (prev._v || 0) + 1
            }));
            updateHistoryStatus?.(res);
            incrementMapVersion?.();
        } catch (e) {
            console.error('Failed to delete feature:', e);
        }
    }, [setGeoJsonData, sessionId, updateHistoryStatus, incrementMapVersion]);

    // ── Merge features ────────────────────────────────────────────────────
    const mergeFeatures = useCallback(async (featureIds) => {
        const data = latestDataRef.current;
        if (!data || !featureIds || featureIds.length < 2) return;
        const toMerge = featureIds.map(id => data.features.find(f => f._id === id)).filter(Boolean);
        if (toMerge.length < 2) return;
        try {
            const res = await geoApi.mergeFeatures(toMerge, sessionId);
            if (res.merged_feature) {
                setGeoJsonData(prev => {
                    let next = prev.features.filter(f => {
                        const fid = f._id || f.id || f.properties?._id || f.properties?.id;
                        return !res.deleted_ids.includes(fid);
                    });
                    const idx = next.findIndex(f => (f._id || f.id) === res.merged_feature._id);
                    if (idx !== -1) next[idx] = res.merged_feature;
                    else next.push(res.merged_feature);
                    return { ...prev, features: next, _v: (prev._v || 0) + 1 };
                });
                updateHistoryStatus?.(res);
                incrementMapVersion?.();
            }
        } catch (e) {
            console.error('Merge failed:', e);
            alert('Failed to merge features: ' + e.message);
        }
    }, [setGeoJsonData, sessionId, updateHistoryStatus, incrementMapVersion]);

    // ── Auto-merge all overlapping groups ─────────────────────────────────
    const autoMergeAllOverlaps = useCallback(async () => {
        const data = latestDataRef.current;
        if (!data?.features) return;
        const groups = findOverlapGroups(data.features);
        if (groups.length === 0) { alert('No overlapping features found to merge.'); return; }
        try {
            for (const group of groups) await mergeFeatures(Array.from(group));
        } catch (e) {
            console.error('Auto-merge failed:', e);
            alert('Auto-merge failed: ' + e.message);
        }
    }, [mergeFeatures]);

    // ── Export layer ──────────────────────────────────────────────────────
    const exportLayer = useCallback(async (format) => {
        const data = latestDataRef.current;
        if (!data) return;
        try {
            const base = (sessionId || 'exported').split('_')[0];
            const blob = await geoApi.exportLayer(data, format, `${base}_edited`, sessionId);
            const url = window.URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), {
                href: url,
                download: `${base}_edited.${format}`
            });
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export failed:', e);
        }
    }, [sessionId]);

    return {
        updateLocalVertex, updateFeatureVertex,
        deleteFeature, mergeFeatures, autoMergeAllOverlaps, exportLayer
    };
};
