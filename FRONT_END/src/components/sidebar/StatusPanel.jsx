import React from 'react';
import { useGeoData } from '../../context/GeoDataContext';
import { AlertCircle, CheckCircle2, Info, RefreshCw } from 'lucide-react';

/**
 * StatusPanel shows the coordinate projection status, 
 * errors, and allows manual coordinate swapping.
 */
export const StatusPanel = React.memo(function StatusPanel() {
    const { coordinateStatus, toggleManualSwap, fileName } = useGeoData();

    if (!fileName && coordinateStatus.type === 'IDLE') return null;

    const getIcon = () => {
        switch (coordinateStatus.type) {
            case 'SUCCESS': return <CheckCircle2 size={16} color="#059669" />;
            case 'WARNING': return <Info size={16} color="#d97706" />;
            case 'ERROR': return <AlertCircle size={16} color="#dc2626" />;
            default: return <Info size={16} color="#64748b" />;
        }
    };

    const getBgColor = () => {
        switch (coordinateStatus.type) {
            case 'SUCCESS': return 'rgba(16, 185, 129, 0.1)';
            case 'WARNING': return 'rgba(245, 158, 11, 0.1)';
            case 'ERROR': return 'rgba(239, 68, 68, 0.1)';
            default: return 'rgba(241, 245, 249, 1)';
        }
    };

    return (
        <div className="status-panel" style={{
            marginTop: '1rem',
            padding: '12px',
            borderRadius: '12px',
            background: getBgColor(),
            border: '1px solid rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.85rem',
            transition: 'all 0.3s ease'
        }}>
            <div style={{ flexShrink: 0 }}>{getIcon()}</div>
            <div style={{ flexGrow: 1, color: '#1e293b', fontWeight: 500, lineHeight: 1.4 }}>
                {coordinateStatus.message || 'Ready for data'}
            </div>
            {coordinateStatus.type === 'WARNING' && (
                <button
                    onClick={toggleManualSwap}
                    className="secondary"
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        height: 'auto',
                        margin: 0,
                        background: 'white',
                        color: '#d97706',
                        border: '1px solid #fbbf24'
                    }}
                >
                    <RefreshCw size={12} style={{ marginRight: '4px' }} />
                    Swap XY
                </button>
            )}
        </div>
    );
});
