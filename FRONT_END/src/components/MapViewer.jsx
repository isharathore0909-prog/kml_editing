import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, ScaleControl } from 'react-leaflet';
import L from 'leaflet';
import { MapController } from './MapController';
import { VertexMarkers } from './VertexMarkers';
import { MapControls } from './map/MapControls';
import { TiledHandler } from './map/TiledHandler';
import { buildPopupHtml } from './map/PopupBuilder';
import { useGeoData } from '../context/GeoDataContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { geoJsonStyle, pointToLayerHandler } from '../utils/mapHandlers';
import 'leaflet/dist/leaflet.css';

// Stable style objects — defined outside component to keep object identity stable
const MERGE_STYLE = { color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 0.6, weight: 3, dashArray: '5, 5' };
const EDITING_STYLE = { opacity: 0, fillOpacity: 0, interactive: false };

export function MapViewer() {
    const {
        geoJsonData, geoJsonBounds, toolMode,
        updateFeatureVertex: onFeatureUpdate,
        deleteFeature: onDeleteFeature,
        editingFeatureId, setEditingFeatureId,
        mergeSelection, setMergeSelection,
        fileName,
        undo, redo, canUndo, canRedo,
        setToolMode,
        mapVersion,
        isTiled, setGeoJsonData, sessionId,
    } = useGeoData();

    const [isTiledLoading, setIsTiledLoading] = useState(false);
    const layerRefs = useRef({});
    const toolModeRef = useRef(toolMode);

    useEffect(() => { toolModeRef.current = toolMode; }, [toolMode]);

    useKeyboardShortcuts({ undo, redo, canUndo, canRedo, setToolMode, setEditingFeatureId, setMergeSelection });

    // ── Apply visual styles based on tool state ───────────────────────────
    useEffect(() => {
        for (const [id, layer] of Object.entries(layerRefs.current)) {
            if (!layer) continue;
            if (id === editingFeatureId) layer.setStyle(EDITING_STYLE);
            else if (mergeSelection.includes(id)) layer.setStyle(MERGE_STYLE);
            else if (layer.setStyle) layer.setStyle(geoJsonStyle);
        }
    }, [editingFeatureId, mergeSelection]);

    // Clear stale refs on file change
    useEffect(() => () => { layerRefs.current = {}; }, [fileName]);

    // ── Feature interaction callbacks ─────────────────────────────────────
    const handleFeatureSelect = useCallback((id) => setEditingFeatureId(id), [setEditingFeatureId]);

    const handleFeatureMergeToggle = useCallback((id) => {
        setMergeSelection(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, [setMergeSelection]);

    const onEachFeature = useCallback((feature, layer) => {
        if (feature._id) layerRefs.current[feature._id] = layer;

        layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            const mode = toolModeRef.current;
            if (mode === 'edit') handleFeatureSelect(feature._id);
            else if (mode === 'delete') { if (window.confirm('Delete this feature?')) { onDeleteFeature(feature._id); layer.remove?.(); } }
            else if (mode === 'merge') handleFeatureMergeToggle(feature._id);
        });

        if (feature.properties) {
            layer.bindPopup(() => buildPopupHtml(feature.properties), { maxWidth: 300, className: 'custom-feature-popup' });
            layer.on('popupopen', () => { if (toolModeRef.current !== 'view') layer.closePopup(); });
        }
    }, [onDeleteFeature, handleFeatureSelect, handleFeatureMergeToggle]);

    const geoJsonKey = useMemo(
        () => `${fileName}-${geoJsonData?.features?.length ?? 0}-${mapVersion}`,
        [fileName, geoJsonData?.features?.length, mapVersion]
    );

    return (
        <main className="map-viewport">
            <MapContainer
                id="map"
                center={[20.5937, 78.9629]}
                zoom={5} minZoom={3}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false} preferCanvas={true} maxBoundsViscosity={1.0}
            >
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    noWrap={true}
                />

                {geoJsonData && (
                    <GeoJSON key={geoJsonKey} data={geoJsonData}
                        style={geoJsonStyle} onEachFeature={onEachFeature} pointToLayer={pointToLayerHandler}
                    />
                )}

                {geoJsonData && (
                    <>
                        <TiledHandler
                            isTiled={isTiled} sessionId={sessionId}
                            geoJsonData={geoJsonData} setGeoJsonData={setGeoJsonData}
                            setIsTiledLoading={setIsTiledLoading}
                            mapVersion={mapVersion}
                        />
                        <MapController />
                        <VertexMarkers bulkLayerRefs={layerRefs} />
                        <MapControls />
                        <ScaleControl position="bottomleft" />
                        {isTiledLoading && (
                            <div className="tiled-loading-indicator">
                                <span className="loader-dot"></span> Streaming features...
                            </div>
                        )}
                    </>
                )}
            </MapContainer>
        </main>
    );
}
