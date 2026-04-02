import React, { useState, useCallback } from 'react';
import { Trash2, Maximize2, Calculator, Loader2, Download } from 'lucide-react';
import { useGeoData } from '../../context/GeoDataContext';
import { OverlapsModal } from '../ui/OverlapsModal';

/**
 * Shows the currently loaded file name, overlap stats, and action buttons.
 * Rendered only when a file is loaded (fileName truthy).
 */
export const FilePanel = React.memo(function FilePanel() {
    const {
        fileName, overlapCount, involvedCount,
        clearData, calculateOverlaps, isCalculating,
        downloadExcel, rawFile,
    } = useGeoData();

    const [showModal, setShowModal] = useState(false);
    const openModal = useCallback(() => setShowModal(true), []);
    const closeModal = useCallback(() => setShowModal(false), []);

    const handleCalculate = useCallback(() => {
        calculateOverlaps(rawFile);
    }, [calculateOverlaps, rawFile]);

    const handleDownload = useCallback(() => {
        downloadExcel(rawFile);
    }, [downloadExcel, rawFile]);


    if (!fileName) return null;

    return (
        <>
            <div className="file-list">
                <h4 style={{ margin: '1rem 0 0.5rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#475569' }}>
                    Active Layer
                </h4>
                <div className="file-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                    {/* File name row + icon buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="file-name" title={fileName}>{fileName}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {overlapCount > 0 && (
                                <button
                                    onClick={openModal}
                                    style={{ background: 'transparent', padding: '6px', margin: 0, boxShadow: 'none', color: '#059669', border: 'none' }}
                                    title="View overlaps table"
                                >
                                    <Maximize2 size={18} />
                                </button>
                            )}
                            <button
                                onClick={clearData}
                                style={{ background: 'transparent', padding: '6px', margin: 0, boxShadow: 'none', color: '#f87171', border: 'none' }}
                                title="Remove layer"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Calculate overlaps CTA */}
                    {overlapCount === null && !isCalculating && (
                        <button onClick={handleCalculate} style={{ width: '100%', marginTop: '4px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
                            <Calculator size={18} />
                            Calculate Overlaps
                        </button>
                    )}

                    {/* Calculating spinner */}
                    {isCalculating && (
                        <button disabled style={{ width: '100%', marginTop: '4px', background: '#94a3b8', cursor: 'not-allowed', boxShadow: 'none' }}>
                            <Loader2 size={18} className="spin" />
                            Calculating…
                        </button>
                    )}

                    {/* Overlap results actions */}
                    {overlapCount > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                            <div style={{ fontSize: '0.8rem', color: '#475569', background: 'rgba(116,198,157,0.1)', borderRadius: '8px', padding: '8px 10px' }}>
                                <strong style={{ color: '#1a4731' }}>{overlapCount}</strong> overlap pairs · <strong style={{ color: '#1a4731' }}>{involvedCount}</strong> features involved
                            </div>
                            <button className="primary" onClick={handleDownload} style={{ width: '100%' }}>
                                <Download size={18} />
                                Download Overlaps (Excel)
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <OverlapsModal show={showModal} onClose={closeModal} />
        </>
    );
});
