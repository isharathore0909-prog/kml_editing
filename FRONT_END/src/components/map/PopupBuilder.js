/**
 * PopupBuilder.js
 * Pure function — no React dependency. Safe to call from Leaflet event handlers.
 */

const EXCLUDED_KEYS = [
    'fillopacity', 'fill', 'strokeopacity', 'stroke', 'strokewidth',
    'id', 'fid', 'marker-symbol', 'marker-color', 'tessellate', 'extrude',
    'visibility', 'styleurl', 'stylepath', 'style'
];

const formatKey = (str) =>
    str.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/**
 * Builds an HTML string for a Leaflet popup from a feature's properties object.
 * @param {Object} properties
 * @returns {string}
 */
export const buildPopupHtml = (properties) => {
    if (!properties) return '';

    let html = `<div class="custom-popup-content">
        <div class="custom-popup-header"><h4>Feature Details</h4></div>
        <div class="custom-popup-body">`;

    for (const [key, val] of Object.entries(properties)) {
        if (val === null || val === undefined || val === '') continue;

        const lowKey = key.toLowerCase();
        const cleanKey = lowKey.replace(/[^a-z]/g, '');
        if (EXCLUDED_KEYS.includes(cleanKey) || EXCLUDED_KEYS.includes(lowKey)) continue;

        // Special handling for KML 'description' blob
        if (lowKey === 'description' && typeof val === 'string') {
            val.split('\n').map(l => l.trim().replace(/^{|}$/g, '')).filter(Boolean).forEach(line => {
                if (line.includes(':')) {
                    const [k, ...v] = line.split(':');
                    if (EXCLUDED_KEYS.includes(k.trim().toLowerCase().replace(/[^a-z]/g, ''))) return;
                    html += `<div class="popup-row">
                        <span class="popup-key">${formatKey(k.trim())}</span>
                        <span class="popup-val">${v.join(':').trim()}</span>
                    </div>`;
                } else if (line.length > 0 && !line.includes('}')) {
                    html += `<div class="popup-row">
                        <span class="popup-val" style="grid-column:span 2;font-style:italic;color:#6b7280;font-size:0.8rem">${line}</span>
                    </div>`;
                }
            });
            continue;
        }

        let displayVal = val;
        if (typeof val === 'string' && val.includes('[object Object]')) continue;
        if (typeof val === 'object') {
            try { displayVal = JSON.stringify(val); } catch { displayVal = String(val); }
            if (displayVal === '{}' || displayVal === '[]') continue;
        }

        html += `<div class="popup-row">
            <span class="popup-key">${formatKey(key)}</span>
            <span class="popup-val">${displayVal}</span>
        </div>`;
    }

    html += `</div></div>`;
    return html;
};
