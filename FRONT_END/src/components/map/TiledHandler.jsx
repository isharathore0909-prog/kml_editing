import React, { useState, useEffect } from 'react';
import { useMapEvents } from 'react-leaflet';
import { geoApi } from '../../api/geoApi';

/**
 * TiledHandler
 * Listens to Leaflet map events and streams features into the viewport
 * via BBox queries when the layer is in tiled mode.
 */
export function TiledHandler({ isTiled, sessionId, geoJsonData, setGeoJsonData, setIsTiledLoading }) {
    const [status, setStatus] = useState({ limited: false, zoomTooLow: false });

    const map = useMapEvents({
        moveend: async () => {
            if (!isTiled || !sessionId) return;

            const zoom = map.getZoom();
            if (zoom < 8) {
                setStatus({ limited: false, zoomTooLow: true });
                return;
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
                    if (!prev) return prev;
                    const featuresById = new Map((prev.features || []).map(f => [f._id, f]));
                    const serverIds = new Set(data.features.map(f => f._id || f.id || (f.properties && (f.properties._id || f.properties.id))));
                    let changed = false;

                    // 1. Sync / Add features from the server
                    data.features.forEach(f => {
                        const fid = f._id || f.id || (f.properties && (f.properties._id || f.properties.id));
                        if (!f._id) f._id = fid;

                        // If it's a new feature, or if it changed (different _v or geometry)
                        if (!featuresById.has(fid)) {
                            featuresById.set(fid, f);
                            changed = true;
                        } else {
                            // Optional: update properties/geometry if server says it's newer
                            // For simplicity, we trust the server's BBox as the current truth
                            if (JSON.stringify(featuresById.get(fid).geometry) !== JSON.stringify(f.geometry)) {
                                featuresById.set(fid, f);
                                changed = true;
                            }
                        }
                    });

                    // 2. PRUNE: Remove features that SHOULD be in this BBox but aren't in the server response
                    // This is how we handle deletions/merges in tiled mode
                    const currentBBoxFeatures = Array.from(featuresById.values()).filter(f => {
                        // Check if centroid or bounds of 'f' is inside the current 'bbox'
                        // If it's inside but NOT in serverIds, it was deleted!
                        const fbbox = f.bbox || [f.geometry.coordinates[0], f.geometry.coordinates[1], f.geometry.coordinates[0], f.geometry.coordinates[1]];
                        const isInside = fbbox[0] >= bbox[0] && fbbox[2] <= bbox[2] &&
                            fbbox[1] >= bbox[1] && fbbox[3] <= bbox[3];

                        if (isInside && !serverIds.has(f._id)) {
                            changed = true;
                            return false; // Prune!
                        }
                        return true;
                    });

                    if (!changed) return prev;
                    return { ...prev, features: currentBBoxFeatures, _v: (prev._v || 0) + 1 };
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
    }, [isTiled, sessionId, map]);

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
