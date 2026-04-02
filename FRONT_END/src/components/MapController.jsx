import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useGeoData } from '../context/GeoDataContext';

export function MapController() {
    const { geoJsonData: data, geoJsonBounds: bounds, fileName } = useGeoData();
    const map = useMap();
    const lastAppliedFile = useRef(null);
    const zoomLock = useRef(false);

    // Track file changes to permit a new zoom action
    useEffect(() => {
        if (fileName && fileName !== lastAppliedFile.current) {
            lastAppliedFile.current = fileName;
            zoomLock.current = false;
        }
    }, [fileName]);

    // Ensure map handles container resizing 
    useEffect(() => {
        if (!map) return;
        const resizeObserver = new ResizeObserver(() => map.invalidateSize());
        const container = map.getContainer();
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, [map]);

    useEffect(() => {
        // Stop if we are already zoomed or there is no data
        if (zoomLock.current || !data) return;

        // Verify geometric features
        const hasValidFeatures = (data.features && data.features.length > 0) ||
            (data.type === 'Feature' && data.geometry);

        if (!hasValidFeatures) return;

        const applyZoom = () => {
            if (zoomLock.current) return;

            try {
                let targetBounds = bounds;

                // If pre-calculated bounds are missing or suspicious, calculate locally
                if (!targetBounds || !Array.isArray(targetBounds) || targetBounds.length !== 2) {
                    const filteredData = JSON.parse(JSON.stringify(data));
                    if (filteredData.features) {
                        filteredData.features = filteredData.features.filter(f => {
                            if (!f.geometry || !f.geometry.coordinates) return true;
                            const coords = f.geometry.coordinates;
                            if (f.geometry.type === 'Point') {
                                return !(coords[0] === 0 && coords[1] === 0);
                            }
                            return true;
                        });
                    }

                    const tempLayer = L.geoJSON(filteredData);
                    const layerBounds = tempLayer.getBounds();
                    if (layerBounds.isValid()) {
                        targetBounds = [
                            [layerBounds.getSouthWest().lat, layerBounds.getSouthWest().lng],
                            [layerBounds.getNorthEast().lat, layerBounds.getNorthEast().lng]
                        ];
                    }
                }

                if (targetBounds) {
                    const latMin = targetBounds[0][0];
                    const lngMin = targetBounds[0][1];
                    const latMax = targetBounds[1][0];
                    const lngMax = targetBounds[1][1];

                    // Check for invalid coordinates
                    const isInvalid = !isFinite(latMin) || !isFinite(lngMin) || !isFinite(latMax) || !isFinite(lngMax);
                    const lngSpan = Math.abs(lngMax - lngMin);
                    const isTooWide = lngSpan > 120;

                    if (!isInvalid && !isTooWide) {
                        map.fitBounds(targetBounds, {
                            padding: [50, 50],
                            animate: true,
                            maxZoom: 16
                        });
                        zoomLock.current = true;
                    } else if (isTooWide) {
                        map.setView([22.5937, 78.9629], 5);
                        zoomLock.current = true;
                    }
                }
            } catch (err) {
                console.error("Auto-zoom error:", err);
            }
        };

        const timer = setTimeout(applyZoom, 600);
        return () => clearTimeout(timer);
    }, [bounds, data, map, fileName]);

    return null;
}
