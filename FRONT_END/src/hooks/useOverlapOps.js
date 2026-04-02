import { useState, useCallback } from 'react';
import { geoApi } from '../api/geoApi';

/**
 * useOverlapOps
 * Handles overlap calculation and Excel download operations.
 */
export const useOverlapOps = (sessionId, setGeoJsonData, {
    setOverlappedFeatures,
    setOverlapCount,
    setInvolvedCount,
    setIsTiled,
    setGeoJsonBounds,
} = {}) => {
    const [isCalculating, setIsCalculating] = useState(false);

    const calculateOverlaps = useCallback(async (rawFile, explicitSessionId, skipOverlaps = false) => {
        if (!rawFile) return;
        const targetSessionId = explicitSessionId || sessionId;
        setIsCalculating(true);
        try {
            const data = await geoApi.calculateOverlaps(rawFile, targetSessionId, skipOverlaps);
            setOverlapCount?.(data.overlapCount);
            setInvolvedCount?.(data.involvedCount);
            setOverlappedFeatures?.(data.pairs || []);
            setIsTiled?.(data.isTiled);

            if (data.isTiled) {
                setGeoJsonData({ type: 'FeatureCollection', features: [] });
            }

            if (data.bounds) {
                setGeoJsonBounds?.([
                    [data.bounds[1], data.bounds[0]],
                    [data.bounds[3], data.bounds[2]]
                ]);
            }
        } catch (error) {
            console.error('Overlaps calculation failed:', error);
            const msg = error.message?.includes('is not valid JSON')
                ? 'Backend returned invalid format. Please check server logs.'
                : 'Internal Server Error calculating overlaps.';
            alert(msg);
        } finally {
            setIsCalculating(false);
        }
    }, [sessionId, setOverlappedFeatures, setOverlapCount, setInvolvedCount, setIsTiled, setGeoJsonBounds, setGeoJsonData]);

    const downloadExcel = useCallback(async (rawFile) => {
        if (!rawFile) return;
        try {
            const blob = await geoApi.downloadOverlapExcel(rawFile);
            const url = window.URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), {
                href: url,
                download: `overlapped_features_${fileName.split('.')[0]}.xlsx`
            });
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Excel download failed:', error);
        }
    }, [sessionId]);

    return { isCalculating, calculateOverlaps, downloadExcel };
};
