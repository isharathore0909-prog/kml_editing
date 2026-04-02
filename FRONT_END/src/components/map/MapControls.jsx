import React, { useMemo, useCallback } from 'react';
import { useGeoData } from '../../context/GeoDataContext';

// SVG icons as stable constants (no re-creation on render)
const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);
const DeleteIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
    </svg>
);
const MergeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 2v20" /><path d="M17 2v20" /><path d="M7 12h10" />
    </svg>
);
const UndoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
);
const RedoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </svg>
);
const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

const Divider = () => (
    <div style={{ height: '1px', background: 'rgba(0,0,0,0.08)', margin: '2px 0' }} />
);

export const MapControls = React.memo(function MapControls() {
    const {
        toolMode, setToolMode, setEditingFeatureId,
        exportLayer, fileName,
        undo, redo, canUndo, canRedo,
        mergeSelection, setMergeSelection, mergeFeatures,
    } = useGeoData();

    const origExt = useMemo(() => {
        if (!fileName) return 'geojson';
        const ext = fileName.split('.').pop().toLowerCase();
        if (ext === 'json' || ext === 'geojson') return 'geojson';
        if (ext === 'kml') return 'kml';
        if (ext === 'kmz') return 'kmz';
        return 'geojson';
    }, [fileName]);

    const altFormats = useMemo(
        () => ['kml', 'kmz', 'geojson'].filter(f => f !== origExt),
        [origExt]
    );

    const resetTools = useCallback(() => {
        setEditingFeatureId(null);
        setMergeSelection([]);
    }, [setEditingFeatureId, setMergeSelection]);

    const handleEditToggle = useCallback((e) => {
        e.preventDefault();
        setToolMode(prev => (prev === 'edit' ? 'view' : 'edit'));
        resetTools();
    }, [setToolMode, resetTools]);

    const handleToggleDelete = useCallback((e) => {
        e.preventDefault();
        setToolMode(prev => (prev === 'delete' ? 'view' : 'delete'));
        resetTools();
    }, [setToolMode, resetTools]);

    const handleToggleMerge = useCallback((e) => {
        e.preventDefault();
        setToolMode(prev => (prev === 'merge' ? 'view' : 'merge'));
        resetTools();
    }, [setToolMode, resetTools]);

    const handleDoMerge = useCallback(async (e) => {
        e.preventDefault();
        if (mergeSelection.length < 2) return;
        if (window.confirm(`Merge ${mergeSelection.length} features into one?`)) {
            await mergeFeatures(mergeSelection);
            setToolMode('view');
            setMergeSelection([]);
        }
    }, [mergeSelection, mergeFeatures, setToolMode, setMergeSelection]);

    const handleExportPrimary = useCallback(() => exportLayer(origExt), [exportLayer, origExt]);

    return (
        <div className="leaflet-top leaflet-right" style={{ top: '16px', right: '16px', pointerEvents: 'auto' }}>
            <div className="download-stack">
                {/* ── Edit tool ── */}
                <button
                    title={toolMode === 'edit' ? 'Finish Editing (Esc)' : 'Enable Vertex Editing'}
                    className={`map-control-btn ${toolMode === 'edit' ? 'active' : 'outline'}`}
                    onClick={handleEditToggle}
                >
                    <EditIcon />
                    <span>{toolMode === 'edit' ? 'Done' : 'Edit'}</span>
                </button>

                {/* ── Delete tool ── */}
                <button
                    title={toolMode === 'delete' ? 'Finish Deleting (Esc)' : 'Delete Features'}
                    className={`map-control-btn ${toolMode === 'delete' ? 'active' : 'outline'}`}
                    onClick={handleToggleDelete}
                >
                    <DeleteIcon />
                    <span>{toolMode === 'delete' ? 'Done' : 'Delete'}</span>
                </button>

                {/* ── Merge tool ── */}
                <button
                    title={toolMode === 'merge' ? 'Finish Merging (Esc)' : 'Merge Features'}
                    className={`map-control-btn ${toolMode === 'merge' ? 'active' : 'outline'}`}
                    onClick={handleToggleMerge}
                >
                    <MergeIcon />
                    <span>{toolMode === 'merge' ? 'Done' : 'Merge'}</span>
                </button>

                {/* ── Confirm merge CTA ── */}
                {toolMode === 'merge' && mergeSelection.length >= 2 && (
                    <button
                        className="map-control-btn primary"
                        style={{ background: '#f59e0b', borderColor: '#d97706' }}
                        onClick={handleDoMerge}
                    >
                        <span>Merge Selected ({mergeSelection.length})</span>
                    </button>
                )}

                <Divider />

                {/* ── Undo / Redo ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                        title="Undo (Ctrl+Z)"
                        className={`map-control-btn ${canUndo ? 'outline' : 'disabled'}`}
                        onClick={undo}
                        disabled={!canUndo}
                        style={{ height: '36px', opacity: canUndo ? 1 : 0.4 }}
                    >
                        <UndoIcon /><span>Undo</span>
                    </button>
                    <button
                        title="Redo (Ctrl+Y)"
                        className={`map-control-btn ${canRedo ? 'outline' : 'disabled'}`}
                        onClick={redo}
                        disabled={!canRedo}
                        style={{ height: '36px', opacity: canRedo ? 1 : 0.4 }}
                    >
                        <RedoIcon /><span>Redo</span>
                    </button>
                </div>

                <Divider />

                {/* ── Primary export ── */}
                <button
                    onClick={handleExportPrimary}
                    className="map-control-btn primary"
                    title={`Download as ${origExt.toUpperCase()}`}
                >
                    <DownloadIcon />
                    <span style={{ textTransform: 'uppercase' }}>{origExt}</span>
                </button>

                {/* ── Alt format exports ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {altFormats.map(format => (
                        <button
                            key={format}
                            onClick={() => exportLayer(format)}
                            className="map-control-btn secondary"
                            style={{ height: '32px', fontSize: '11px' }}
                            title={`Export as ${format.toUpperCase()}`}
                        >
                            {format.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
});
