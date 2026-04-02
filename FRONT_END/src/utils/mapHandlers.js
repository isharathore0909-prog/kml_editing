import L from 'leaflet';

export const geoJsonStyle = {
    fillColor: "#10b981",
    weight: 2,
    opacity: 1,
    color: "#059669",
    fillOpacity: 0.3
};

// Force Leaflet to render lightweight CircleMarkers instead of <img> markers
// This prevents the browser from crashing when loading files with 50k+ points!
export const pointToLayerHandler = (feature, latlng) => {
    return L.circleMarker(latlng, {
        radius: 5,
        fillColor: "#3b82f6",
        color: "#ffffff",
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.8
    });
};

export const onEachFeatureHandler = (feature, layer) => {
    if (feature.properties) {
        // Bind popup with a function so it only evaluates and creates HTML strings on click, 
        // saving massive amounts of memory for 50k+ features!
        layer.bindPopup(() => {
            const propertiesList = Object.entries(feature.properties)
                .map(([key, val]) => {
                    const displayValue = typeof val === 'object' ? JSON.stringify(val) : val;
                    return `
                        <div style="margin-bottom: 8px; display: flex; flex-direction: column; border-bottom: 1px solid #edf7ee; padding-bottom: 6px;">
                            <span style="color: #2d6a4f; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">${key}</span>
                            <span style="color: #111827; font-size: 0.88rem; font-weight: 500; margin-top: 2px;">${displayValue}</span>
                        </div>
                    `;
                }).join('');

            return `
                <div style="font-family: 'Poppins', 'Outfit', sans-serif; padding: 14px; min-width: 180px; color: #111827;">
                    <h4 style="margin: 0 0 10px 0; color: #1a4731; border-bottom: 2px solid #d8f3dc; padding-bottom: 8px; font-size: 0.9rem; font-weight: 700; letter-spacing: 0.2px;">📍 Feature Info</h4>
                    <div style="max-height: 200px; overflow-y: auto; padding-right: 4px;">
                        ${propertiesList}
                    </div>
                </div>
            `;
        }, { className: 'custom-popup' });

        // Hover effects (only apply if the layer holds styles like Polygons/CircleMarkers)
        layer.on({
            mouseover: (e) => {
                const l = e.target;
                if (l.setStyle) {
                    l.setStyle({
                        fillOpacity: 0.6,
                        weight: 3,
                        color: "#10b981"
                    });
                }
                if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge && l.bringToFront) {
                    l.bringToFront();
                }
            },
            mouseout: (e) => {
                const l = e.target;
                if (l.setStyle) {
                    // Try to reset to geometry style or point style
                    if (feature.geometry && feature.geometry.type === 'Point') {
                        l.setStyle({
                            radius: 5,
                            fillColor: "#3b82f6",
                            color: "#ffffff",
                            weight: 1.5,
                            opacity: 1,
                            fillOpacity: 0.8
                        });
                    } else {
                        l.setStyle(geoJsonStyle);
                    }
                }
            }
        });
    }
};
