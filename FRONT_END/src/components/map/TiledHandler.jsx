import React, { useState, useEffect } from 'react';
import { useMapEvents } from 'react-leaflet';
import { geoApi } from '../../api/geoApi';

/**
 * TiledHandler
 * Listens to Leaflet map events and streams features into the viewport
 * via BBox queries when the layer is in tiled mode.
 */
export function TiledHandler({ isTiled, sessionId, geoJsonData, setGeoJsonData, setIsTiledLoading, mapVersion }) {
    const [status, setStatus] = useState({ limited: false, zoomTooLow: false });

    const map = useMapEvents({
        moveend: async () => {
            if (!isTiled || !sessionId) return;

            const zoom = map.getZoom();
            if (zoom < 8) {
                setStatus({ limited: true, zoomTooLow: true });
            } else {
                setStatus(prev => ({ ...prev, zoomTooLow: false }));
            }

            const bounds = map.getBounds();
            const bbox = [
                bounds.getWest(), bounds.getSouth(),
                bounds.getEast(), bounds.getNorth()
            ];

            try {
                setIsTiledLoading(true);
                const data = await geoApi.getBBoxFeatures(sessionId, bbox);

                setStatus({ limited: data.limited || false, zoomTooLow: false });

                setGeoJsonData(prev => {
                    const features = prev?.features || [];
                    const incomingIds = new Set(data.features.map(f => f._id || f.id || (f.properties && (f.properties._id || f.properties.id))));

                    // Pruning: ONLY prune if the response is NOT limited.
                    // If the server says "limited", it means we don't have the full truth for this BBox,
                    // so we shouldn't delete anything based on its absence.
                    const filtered = data.limited ? features : features.filter(f => {
                        const fid = f._id || f.id || (f.properties && (f.properties._id || f.properties.id));
                        if (incomingIds.has(fid)) return false; // We'll add/update it from incoming data

                        // If it's outside our current fetch bounds, keep it
                        if (!f.geometry || !f.geometry.coordinates) return true;

                        // Simple centroid/representative point check for BBox membership
                        const coords = f.geometry.coordinates;
                        const [lng, lat] = f.geometry.type === 'Point'
                            ? coords
                            : (f.geometry.type === 'Polygon' ? coords[0][0] : coords[0][0][0]);

                        const isInsideBBox = lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
                        return !isInsideBBox; // If inside but missing from server, drop it.
                    });

                    // Upsert incoming
                    const nextFeatures = [...filtered];
                    data.features.forEach(f => {
                        if (!f._id) f._id = f.id || (f.properties && (f.properties._id || f.properties.id));
                        // Deduplicate in case we didn't prune (e.g. if limited)
                        if (!nextFeatures.some(ex => ex._id === f._id)) {
                            nextFeatures.push(f);
                        }
                    });

                    // Check for identity change to prevent unnecessary re-renders
                    if (nextFeatures.length === features.length && nextFeatures.every((f, i) => f === features[i])) return prev;
                    return { ...prev, features: nextFeatures, _v: (prev._v || 0) + 1 };
                });
            } catch (e) {
                console.error('BBox fetch failed:', e);
            } finally {
                setIsTiledLoading(false);
            }
        },
    });

    useEffect(() => {
        if (isTiled && sessionId) map.fire('moveend');
    }, [isTiled, sessionId, map, mapVersion]);

    return (
        <div className="tiled-status-overlay">
            {(status.zoomTooLow || (status.limited && !geoJsonData?.features?.length)) && (
                <div className="status-pill warning">
                    <span className="icon">🔍</span> Zoom in to see features
                </div>
            )}
            {status.limited && geoJsonData?.features?.length > 0 && (
                <div className="status-pill info">
                    <span className="icon">⚠️</span> Density High: Showing first 5000 features
                </div>
            )}
        </div>
    );
}
