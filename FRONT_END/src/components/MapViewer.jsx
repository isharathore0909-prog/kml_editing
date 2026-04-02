import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, ScaleControl, useMapEvents } from 'react-leaflet';
import { geoApi } from '../api/geoApi';
import L from 'leaflet';
import { MapController } from './MapController';
import { VertexMarkers } from './VertexMarkers';
import { MapControls } from './map/MapControls';
import { useGeoData } from '../context/GeoDataContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { geoJsonStyle, pointToLayerHandler } from '../utils/mapHandlers';
import 'leaflet/dist/leaflet.css';

// ── Popup HTML builder (pure fn — no hooks, safe to call from Leaflet) ────
const buildPopupHtml = (properties) => {
    if (!properties) return '';
    let html = `<div class="custom-popup-content">
        <div class="custom-popup-header">
            <h4>Feature Details</h4>
        </div>
        <div class="custom-popup-body">`;
    const EXCLUDED_STRINGS = [
        'fillopacity', 'fill', 'strokeopacity', 'stroke', 'strokewidth',
        'id', 'fid', 'marker-symbol', 'marker-color', 'tessellate', 'extrude', 'visibility',
        'styleurl', 'stylepath', 'style'
    ];

    const formatKey = (str) => str.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    for (const [key, val] of Object.entries(properties)) {
        if (val === null || val === undefined || val === '') continue;

        const lowKey = key.toLowerCase();
        const cleanKey = lowKey.replace(/[^a-z]/g, ''); // strip dashes/underscores for check

        if (EXCLUDED_STRINGS.includes(cleanKey) || EXCLUDED_STRINGS.includes(lowKey)) continue;

        // Special handling for KML 'description' blob (often contains newline-separated data)
        if (lowKey === 'description' && typeof val === 'string') {
            const lines = val.split('\n').map(l => l.trim().replace(/^{|}$/g, '')).filter(Boolean);
            lines.forEach(line => {
                if (line.includes(':')) {
                    const [k, ...v] = line.split(':');
                    const cleanK = k.trim().toLowerCase().replace(/[^a-z]/g, '');
                    if (EXCLUDED_STRINGS.includes(cleanK)) return;

                    html += `
                        <div class="popup-row">
                            <span class="popup-key">${formatKey(k.trim())}</span>
                            <span class="popup-val">${v.join(':').trim()}</span>
                        </div>`;
                } else if (line.length > 0 && !line.includes('}')) {
                    html += `
                        <div class="popup-row">
                            <span class="popup-val" style="grid-column: span 2; font-style: italic; color: #6b7280; font-size: 0.8rem;">${line}</span>
                        </div>`;
                }
            });
            continue;
        }

        let displayVal = val;
        if (typeof val === 'string' && val.includes('[object Object]')) continue;
        if (typeof val === 'object') {
            try { displayVal = JSON.stringify(val); }
            catch (e) { displayVal = String(val); }
            if (displayVal === '{}' || displayVal === '[]') continue;
        }

        html += `
            <div class="popup-row">
                <span class="popup-key">${formatKey(key)}</span>
                <span class="popup-val">${displayVal}</span>
            </div>`;
    }
    html += `</div></div>`;
    return html;
};

// Merge-highlight style (kept outside component — object identity stable)
const MERGE_STYLE = { color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 0.6, weight: 3, dashArray: '5, 5' };
const EDITING_STYLE = { opacity: 0, fillOpacity: 0, interactive: false };

// ── Tiled Data Handler (BBox Streaming) ──────────────────────────────────
function TiledHandler({ isTiled, fileName, geoJsonData, setGeoJsonData, setIsTiledLoading }) {
    const [status, setStatus] = useState({ limited: false, zoomTooLow: false });

    const map = useMapEvents({
        moveend: async () => {
            if (!isTiled || !fileName) return;

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
                const data = await geoApi.getBBoxFeatures(fileName, bbox);

                setStatus({
                    limited: data.limited || false,
                    zoomTooLow: false
                });

                setGeoJsonData(prev => {
                    const featuresById = new Map((prev?.features || []).map(f => [f._id, f]));
                    let changed = false;

                    data.features.forEach(f => {
                        const fid = f._id || f.id || (f.properties && (f.properties._id || f.properties.id));
                        if (!f._id) f._id = fid;

                        if (!featuresById.has(f._id)) {
                            featuresById.set(f._id, f);
                            changed = true;
                        }
                    });

                    if (!changed) return prev;

                    return {
                        ...prev,
                        features: Array.from(featuresById.values()),
                        _v: (prev._v || 0) + 1
                    };
                });
            } catch (e) {
                console.error("BBox fetch failed:", e);
            } finally {
                setIsTiledLoading(false);
            }
        },
    });

    useEffect(() => {
        if (isTiled && fileName) {
            map.fire('moveend');
        }
    }, [isTiled, fileName, map]);

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
        isTiled, setGeoJsonData,
    } = useGeoData();

    const [isTiledLoading, setIsTiledLoading] = useState(false);

    const layerRefs = useRef({});
    const toolModeRef = useRef(toolMode);

    // Keep toolModeRef fresh without re-creating closures
    useEffect(() => { toolModeRef.current = toolMode; }, [toolMode]);

    // Global keyboard shortcuts (Ctrl+Z / Ctrl+Y / Escape)
    useKeyboardShortcuts({ undo, redo, canUndo, canRedo, setToolMode, setEditingFeatureId, setMergeSelection });

    // ── Apply visual styles based on tool state ───────────────────────────
    useEffect(() => {
        for (const id of Object.keys(layerRefs.current)) {
            const layer = layerRefs.current[id];
            if (!layer) continue;
            if (id === editingFeatureId) {
                layer.setStyle(EDITING_STYLE);
            } else if (mergeSelection.includes(id)) {
                layer.setStyle(MERGE_STYLE);
            } else {
                if (layer.setStyle) layer.setStyle(geoJsonStyle);
            }
        }
    }, [editingFeatureId, mergeSelection]);

    // Clear stale layer refs when a new file is loaded
    useEffect(() => {
        return () => { layerRefs.current = {}; };
    }, [fileName]);

    // ── Feature interaction callbacks ─────────────────────────────────────
    const handleFeatureSelect = useCallback((featureId) => {
        setEditingFeatureId(featureId);
    }, [setEditingFeatureId]);

    const handleFeatureMergeToggle = useCallback((featureId) => {
        setMergeSelection(prev =>
            prev.includes(featureId) ? prev.filter(id => id !== featureId) : [...prev, featureId]
        );
    }, [setMergeSelection]);

    const onEachFeature = useCallback((feature, layer) => {
        if (feature._id) {
            layerRefs.current[feature._id] = layer;
        }

        layer.on('click', (e) => {
            const mode = toolModeRef.current;
            L.DomEvent.stopPropagation(e);

            if (mode === 'edit') {
                handleFeatureSelect(feature._id);
            } else if (mode === 'delete') {
                if (window.confirm('Delete this feature?')) {
                    onDeleteFeature(feature._id);
                    layer.remove?.();
                }
            } else if (mode === 'merge') {
                handleFeatureMergeToggle(feature._id);
            }
        });

        if (feature.properties) {
            layer.bindPopup(() => buildPopupHtml(feature.properties), {
                maxWidth: 300,
                className: 'custom-feature-popup',
            });
            layer.on('popupopen', () => {
                if (toolModeRef.current !== 'view') layer.closePopup();
            });
        }
    }, [onDeleteFeature, handleFeatureSelect, handleFeatureMergeToggle]);

    // Stable GeoJSON key: remount layer when file, feature count, or mapVersion changes
    const geoJsonKey = useMemo(
        () => `${fileName}-${geoJsonData?.features?.length ?? 0}-${mapVersion}`,
        [fileName, geoJsonData?.features?.length, mapVersion]
    );

    return (
        <main className="map-viewport">
            <MapContainer
                id="map"
                center={[20.5937, 78.9629]}
                zoom={5}
                minZoom={3}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
                preferCanvas={true}
                maxBoundsViscosity={1.0}
            >
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    noWrap={true}
                />

                {geoJsonData && (
                    <GeoJSON
                        key={geoJsonKey}
                        data={geoJsonData}
                        style={geoJsonStyle}
                        onEachFeature={onEachFeature}
                        pointToLayer={pointToLayerHandler}
                    />
                )}

                {geoJsonData && (
                    <>
                        <TiledHandler
                            isTiled={isTiled}
                            fileName={fileName}
                            geoJsonData={geoJsonData}
                            setGeoJsonData={setGeoJsonData}
                            setIsTiledLoading={setIsTiledLoading}
                        />
                        <MapController />
                        <VertexMarkers bulkLayerRefs={layerRefs} />
                        <MapControls />
                        <ScaleControl position="bottomleft" />
                        {isTiledLoading && (
                            <div className="tiled-loading-indicator">
                                <span className="loader-dot"></span>
                                Streaming features...
                            </div>
                        )}
                    </>
                )}
            </MapContainer>
        </main>
    );
}
