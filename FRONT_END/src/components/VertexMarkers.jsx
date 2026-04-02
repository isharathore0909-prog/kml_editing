import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useGeoData } from '../context/GeoDataContext';

export function VertexMarkers({ bulkLayerRefs }) {
    const {
        geoJsonData, toolMode, editingFeatureId, updateFeatureVertex: onFeatureUpdate
    } = useGeoData();

    const map = useMap();
    const markersLayerRef = useRef(null);
    const tempLayerRef = useRef(null);
    const lastSelectionRef = useRef({ mode: null, featureId: null });

    useEffect(() => {
        if (!map) return;
        markersLayerRef.current = new L.LayerGroup().addTo(map);
        return () => {
            if (markersLayerRef.current) markersLayerRef.current.remove();
            if (tempLayerRef.current) tempLayerRef.current.remove();
        };
    }, [map]);

    useEffect(() => {
        if (!markersLayerRef.current || !map) return;

        const currentFeature = (geoJsonData && editingFeatureId !== null)
            ? geoJsonData.features.find(f => f._id === editingFeatureId)
            : null;

        const selectionChanged =
            lastSelectionRef.current.mode !== toolMode ||
            lastSelectionRef.current.featureId !== editingFeatureId;

        if (!selectionChanged) return;

        markersLayerRef.current.clearLayers();
        if (tempLayerRef.current) {
            tempLayerRef.current.remove();
            tempLayerRef.current = null;
        }

        if (toolMode !== 'edit' || !currentFeature) {
            lastSelectionRef.current = { mode: toolMode, featureId: editingFeatureId };
            return;
        }

        const tempLayer = L.GeoJSON.geometryToLayer(currentFeature);
        const setupTempStyle = (l) => {
            if (l.setStyle) {
                l.setStyle({ color: '#f59e0b', weight: 4, fillOpacity: 0.1, dashArray: '6, 10' });
            }
            if (l.options) l.options.interactive = false;
        };

        if (tempLayer instanceof L.LayerGroup) tempLayer.eachLayer(setupTempStyle);
        else setupTempStyle(tempLayer);

        tempLayer.addTo(map);
        tempLayerRef.current = tempLayer;

        const handleIcon = L.divIcon({
            className: 'vertex-marker-container',
            html: `<div style="width: 14px; height: 14px; background: #fbbf24; border: 2px solid white; border-radius: 50%; box-shadow: 0 3px 6px rgba(0,0,0,0.4); cursor: move;"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        const updateLeafLayerGeometry = (leafLayer, path, newPos) => {
            const applyToLayer = (l) => {
                if (l instanceof L.Marker || l instanceof L.CircleMarker) {
                    l.setLatLng(newPos);
                } else if (l instanceof L.Polyline) {
                    const latlngs = l.getLatLngs();
                    if (l instanceof L.Polygon) {
                        const ring = latlngs[path.ring_index ?? 0];
                        if (ring) {
                            ring[path.vertex_index] = newPos;
                            if (path.vertex_index === 0) ring[ring.length - 1] = newPos;
                            l.setLatLngs(latlngs);
                        }
                    } else {
                        latlngs[path.vertex_index] = newPos;
                        l.setLatLngs(latlngs);
                    }
                    if (l.redraw) l.redraw();
                }
            };

            applyToLayer(leafLayer);

            if (bulkLayerRefs?.current && editingFeatureId) {
                const bulkLayer = bulkLayerRefs.current[editingFeatureId];
                if (bulkLayer) {
                    if (bulkLayer instanceof L.FeatureGroup || bulkLayer instanceof L.LayerGroup) {
                        const layers = bulkLayer.getLayers();
                        const subLayer = layers[path.part_index ?? 0];
                        if (subLayer) applyToLayer(subLayer);
                    } else {
                        applyToLayer(bulkLayer);
                    }
                }
            }
        };

        const addHandle = (latlng, path, leafLayer) => {
            const marker = L.marker(latlng, { draggable: true, zIndexOffset: 3000, icon: handleIcon });
            marker.on('dragstart', () => map.dragging.disable());
            marker.on('drag', (e) => updateLeafLayerGeometry(leafLayer, path, e.target.getLatLng()));
            marker.on('dragend', (e) => {
                map.dragging.enable();
                const newPos = e.target.getLatLng();
                onFeatureUpdate(editingFeatureId, {
                    new_lng: newPos.lng,
                    new_lat: newPos.lat,
                    vertex_path: {
                        part_index: path.part_index ?? 0,
                        ring_index: path.ring_index ?? 0,
                        vertex_index: path.vertex_index ?? 0
                    }
                });
            });
            marker.addTo(markersLayerRef.current);
        };

        const traverseAndAddHandles = (layer, part_index = null) => {
            if (layer instanceof L.FeatureGroup || layer instanceof L.LayerGroup) {
                let idx = 0;
                layer.eachLayer(l => traverseAndAddHandles(l, idx++));
                return;
            }
            if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
                addHandle(layer.getLatLng(), { part_index }, layer);
            } else if (layer instanceof L.Polyline) {
                const latlngs = layer.getLatLngs();
                if (layer instanceof L.Polygon) {
                    latlngs.forEach((ring, ring_index) => {
                        ring.forEach((ll, vertex_index) => {
                            if (vertex_index === ring.length - 1) return;
                            addHandle(ll, { part_index, ring_index, vertex_index }, layer);
                        });
                    });
                } else {
                    latlngs.forEach((ll, vertex_index) => {
                        addHandle(ll, { part_index, vertex_index }, layer);
                    });
                }
            }
        };

        traverseAndAddHandles(tempLayer);
        lastSelectionRef.current = { mode: toolMode, featureId: editingFeatureId };

    }, [geoJsonData, toolMode, editingFeatureId, map, onFeatureUpdate]);

    return null;
}
