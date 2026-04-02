import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGeoData } from '../../context/GeoDataContext';

const PAGE_SIZE = 100;

export function OverlapsModal({ show, onClose }) {
    const {
        overlappedFeatures, overlapCount, involvedCount, downloadExcel
    } = useGeoData();

    const [currentPage, setCurrentPage] = useState(1);

    // Reset pagination when modal opens
    useEffect(() => {
        if (show) setCurrentPage(1);
    }, [show]);

    const sortedFeatures = useMemo(() => {
        if (!overlappedFeatures || overlappedFeatures.length === 0) return [];
        return [...overlappedFeatures].sort((a, b) => {
            const deptA = String(a["Plantation By (Department)"] || "").trim();
            const deptB = String(b["Plantation By (Department)"] || "").trim();
            if (deptA !== deptB) return deptA.localeCompare(deptB, undefined, { sensitivity: 'base' });
            const idA = String(a["Plantation ID"] || "").trim();
            const idB = String(b["Plantation ID"] || "").trim();
            return idA.localeCompare(idB, undefined, { numeric: true });
        });
    }, [overlappedFeatures]);

    const tableHeaders = useMemo(() => {
        if (sortedFeatures.length === 0) return [];
        // For performance, if the list is huge, we'll scan the first 100 features to build the header set
        // (assuming features are mostly homogeneous)
        const EXCLUDED_KEYS = ['description', 'fill-opacity', 'fill', 'stroke-opacity', 'stroke', 'stroke-width', 'id', '_id', 'marker-symbol', 'marker-color'];
        const sampleSize = Math.min(sortedFeatures.length, 100);
        const headers = new Set();
        for (let i = 0; i < sampleSize; i++) {
            Object.keys(sortedFeatures[i]).forEach(k => {
                if (!EXCLUDED_KEYS.includes(k.toLowerCase())) {
                    headers.add(k);
                }
            });
        }
        return Array.from(headers);

    }, [sortedFeatures]);

    const totalPages = Math.ceil(sortedFeatures.length / PAGE_SIZE);
    const paginatedFeatures = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return sortedFeatures.slice(start, start + PAGE_SIZE);
    }, [sortedFeatures, currentPage]);

    if (!show) return null;

    return createPortal(
        <div className="csv-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="csv-modal">
                <div className="csv-modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="csv-modal-icon">
                            <Maximize2 size={18} color="#2d6a4f" />
                        </div>
                        <div>
                            <h2 className="csv-modal-title">Overlap Analysis Report</h2>
                            <p className="csv-modal-subtitle">
                                {overlapCount} overlap pairs · {involvedCount} features involved
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {totalPages > 1 && (
                            <div className="pagination-controls-header">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="pagination-btn"
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <span className="pagination-info">
                                    Page <strong>{currentPage}</strong> of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="pagination-btn"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                        <button className="csv-download-btn" onClick={downloadExcel}>
                            <Download size={16} />
                            Download Excel
                        </button>
                        <button
                            className="csv-close-btn"
                            onClick={onClose}
                            title="Close"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="csv-modal-body">
                    {paginatedFeatures.length > 0 ? (
                        <>
                            <table className="csv-table">
                                <thead>
                                    <tr>
                                        <th className="csv-th csv-th-idx">#</th>
                                        {tableHeaders.map(h => (
                                            <th key={h} className="csv-th">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedFeatures.map((row, i) => {
                                        const globalIndex = (currentPage - 1) * PAGE_SIZE + i;
                                        const prevRow = i > 0 ? paginatedFeatures[i - 1] : (currentPage > 1 ? sortedFeatures[globalIndex - 1] : null);
                                        const prevId = prevRow ? prevRow["Plantation ID"] : null;
                                        const isDuplicate = row["Plantation ID"] && row["Plantation ID"] === prevId;
                                        return (
                                            <tr key={globalIndex} className={`csv-tr ${isDuplicate ? 'csv-tr-dup' : ''}`}>
                                                <td className="csv-td csv-td-idx">{globalIndex + 1}</td>
                                                {tableHeaders.map(h => {
                                                    const val = row[h];
                                                    const blank = isDuplicate && ["Plantation ID", "Plantation By (Department)", "Plants Name", "No. of Plants", "Area (Text)", "Actual Area (hectares)", "Created At"].includes(h);
                                                    return (
                                                        <td key={h} className={`csv-td ${blank ? 'csv-td-blank' : ''}`}>
                                                            {blank ? '' : (val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val))}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {totalPages > 1 && (
                                <div className="csv-modal-footer">
                                    <div className="pagination-controls">
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="pagination-btn"
                                        >
                                            <ChevronLeft size={18} /> Previous
                                        </button>
                                        <span className="pagination-info">
                                            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            className="pagination-btn"
                                        >
                                            Next <ChevronRight size={18} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="csv-empty">No overlap data available.</div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
