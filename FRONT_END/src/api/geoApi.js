import BASE_URL, { API_ENDPOINTS } from './config';

// Leaflet layer reference — strip before sending to avoid circular JSON
const LEAFLET_KEY = '_leafletLayer';

/**
 * Central fetch wrapper.
 * - Strips `_leafletLayer` from JSON bodies automatically.
 * - Throws a descriptive Error on non-OK responses.
 * - Accepts an optional AbortSignal for request cancellation.
 */
async function request(url, options = {}) {
    const { asBlob = false, formData, json, signal, ...fetchOpts } = options;

    const headers = { ...fetchOpts.headers };
    let body = fetchOpts.body;

    if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json, (key, val) => (key === LEAFLET_KEY ? undefined : val));
    } else if (formData) {
        body = formData;
    }

    const res = await fetch(`${BASE_URL}${url}`, {
        ...fetchOpts,
        headers,
        body,
        signal,
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Request failed: ${res.status}`);
    }

    return asBlob ? res.blob() : res.json();
}

/** Strip internal Leaflet ref from a single feature object. */
const cleanFeature = (f) => {
    const copy = { ...f };
    delete copy[LEAFLET_KEY];
    return copy;
};

export const geoApi = {
    calculateOverlaps: (file, sessionId = 'default', skipOverlaps = false) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('session_id', sessionId);
        const query = skipOverlaps ? '?format=json&skip_overlaps=true' : '?format=json';
        return request(`${API_ENDPOINTS.CALCULATE_OVERLAPS}${query}`, { method: 'POST', formData: fd });
    },

    downloadOverlapExcel: (file) => {
        const fd = new FormData();
        fd.append('file', file);
        return request(`${API_ENDPOINTS.CALCULATE_OVERLAPS}?format=xlsx`, { method: 'POST', formData: fd, asBlob: true });
    },

    /**
     * Records a vertex edit in history using a LIGHTWEIGHT payload.
     * Only sends feature_id + old/new coordinates — NOT the full feature.
     * This is the fast path for vertex edits.
     *
     * @param {string} featureId   - Internal _id of the feature
     * @param {object} oldFeature  - The full feature BEFORE the edit (for history old_data)
     * @param {object} newGeometry - The updated geometry object (for history new_data)
     * @param {object} vertexPath  - { part_index, ring_index, vertex_index }
     * @param {number} newLng
     * @param {number} newLat
     * @param {string} sessionId
     * @param {AbortSignal} [signal]
     */
    recordVertexEdit: (featureId, vertexPath, oldPos, newPos, fileName = 'default', signal) =>
        request(API_ENDPOINTS.RECORD_VERTEX_EDIT, {
            method: 'POST',
            json: {
                session_id: fileName,
                feature_id: featureId,
                vertex_path: vertexPath,
                old_pos: oldPos, // [lng, lat]
                new_pos: newPos  // [lng, lat]
            },
            signal,
        }),

    /**
     * Full vertex update (used as fallback if recordVertexEdit endpoint not available).
     * Sends the entire feature — slow for large polygons.
     */
    updateVertex: (feature, path, newLng, newLat, sessionId = 'default', signal) =>
        request(API_ENDPOINTS.VECTOR_OPERATION, {
            method: 'POST',
            json: {
                operation: 'update_vertex',
                features: [cleanFeature(feature)],
                vertex_path: path,
                new_lng: newLng,
                new_lat: newLat,
                session_id: sessionId,
            },
            signal,
        }),

    /**
     * Records a feature deletion in history using a LIGHTWEIGHT payload.
     */
    recordDeletion: (feature, sessionId = 'default') =>
        request(API_ENDPOINTS.RECORD_DELETION, {
            method: 'POST',
            json: {
                session_id: sessionId,
                feature: cleanFeature(feature),
            },
        }),

    deleteFeature: (feature, sessionId = 'default') =>
        request(API_ENDPOINTS.RECORD_DELETION, {
            method: 'POST',
            json: {
                session_id: sessionId,
                feature: cleanFeature(feature),
            },
        }),

    mergeFeatures: (features, sessionId = 'default') =>
        request(API_ENDPOINTS.VECTOR_OPERATION, {
            method: 'POST',
            json: {
                operation: 'merge_features',
                features: features.map(cleanFeature),
                session_id: sessionId,
            },
        }),

    exportLayer: (geoJsonData, format, filename) =>
        request(`${API_ENDPOINTS.EXPORT_LAYER}?format=${format}&filename=${filename}`, {
            method: 'POST',
            json: geoJsonData,
            asBlob: true,
        }),

    pushHistoryAction: (actionType, featureId, oldData, newData, sessionId = 'default') =>
        request(API_ENDPOINTS.HISTORY_PUSH, {
            method: 'POST',
            json: { session_id: sessionId, action_type: actionType, feature_id: featureId, old_data: oldData, new_data: newData },
        }),

    undoHistory: (sessionId = 'default') =>
        request(`${API_ENDPOINTS.HISTORY_UNDO}?session_id=${encodeURIComponent(sessionId)}`),

    redoHistory: (sessionId = 'default') =>
        request(`${API_ENDPOINTS.HISTORY_REDO}?session_id=${encodeURIComponent(sessionId)}`),

    getHistoryStatus: (sessionId = 'default') =>
        request(`${API_ENDPOINTS.HISTORY_STATUS}?session_id=${encodeURIComponent(sessionId)}`),

    getBBoxFeatures: (sessionId, bbox) => {
        const bboxStr = bbox.join(',');
        return request(`${API_ENDPOINTS.GET_BBOX_FEATURES}?session_id=${encodeURIComponent(sessionId)}&bbox=${bboxStr}`);
    },
};
