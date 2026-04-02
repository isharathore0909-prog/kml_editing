import React from 'react';
import { Leaf } from 'lucide-react';

export const Header = React.memo(function Header() {
    return (
        <header>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Govt leaf emblem */}
                <div style={{
                    width: '44px', height: '44px',
                    borderRadius: '50%',
                    background: 'rgba(116, 198, 157, 0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Leaf size={24} color="#2d6a4f" />
                </div>
                <div>
                    <h1>GeoExplorer</h1>
                    <div style={{ fontSize: '0.72rem', color: '#4a6355', marginTop: '-2px', letterSpacing: '0.5px', fontWeight: 500 }}>
                        GEOSPATIAL ANALYSIS PLATFORM
                    </div>
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="badge badge-geojson">Interactive Mapper</span>
            </div>
        </header>
    );
});
