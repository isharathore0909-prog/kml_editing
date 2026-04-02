import React from 'react';
import L from 'leaflet';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { MapViewer } from './components/MapViewer';
import { MapOverlay } from './components/map/MapOverlay';
import { GeoDataProvider } from './context/GeoDataContext';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: iconRetina,
    iconUrl: icon,
    shadowUrl: iconShadow,
});

function AppContent() {
    return (
        <div className="app-container">
            <Header />
            <div className="main-content">
                <Sidebar />
                <MapViewer />
                <MapOverlay />
            </div>
        </div>
    );
}

function App() {
    return (
        <GeoDataProvider>
            <AppContent />
        </GeoDataProvider>
    );
}

export default App;
