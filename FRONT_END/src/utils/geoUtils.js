import proj4 from 'proj4';

// Common projections
proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs");

/**
 * Recursively transforms coordinates in a GeoJSON structure.
 * @param {Object} data        - GeoJSON FeatureCollection / Feature / geometry
 * @param {Function} transformFn - ([x, y, ...]) => [newX, newY]
 */
export const transformCoordinates = (data, transformFn) => {
    const newData = JSON.parse(JSON.stringify(data));

    const processCoords = (coords) =>
        typeof coords[0] === 'number' ? transformFn(coords) : coords.map(processCoords);

    const transformGeom = (geom) => {
        if (geom.type === 'GeometryCollection') geom.geometries?.forEach(transformGeom);
        else if (geom.coordinates) geom.coordinates = processCoords(geom.coordinates);
    };

    const processFeature = (feature) => { if (feature.geometry) transformGeom(feature.geometry); return feature; };

    if (newData.type === 'FeatureCollection') newData.features = newData.features.map(processFeature);
    else if (newData.type === 'Feature') processFeature(newData);
    else if (newData?.geometry?.coordinates) newData.geometry.coordinates = processCoords(newData.geometry.coordinates);

    return newData;
};

/**
 * Analyzes GeoJSON data: detects CRS, reprojects if needed, and computes bounds.
 * @param {Object} data
 * @returns {{ finalData, msg, statusType, bounds, hasFeatures }}
 */
export const analyzeGeoData = (data) => {
    if (!data) return { finalData: null, msg: 'No data found', statusType: 'ERROR', bounds: null, hasFeatures: false };

    let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    const findBounds = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            if (typeof obj[0] === 'number' && typeof obj[1] === 'number') {
                const [x, y] = obj;
                if (Math.abs(x) < 0.0000001 || Math.abs(y) < 0.0000001) return;
                if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
                if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
            } else { for (const item of obj) findBounds(item); }
        } else {
            if (obj.features) findBounds(obj.features);
            else if (obj.geometry) findBounds(obj.geometry);
            else if (obj.geometries) findBounds(obj.geometries);
            else if (obj.coordinates) findBounds(obj.coordinates);
        }
    };

    findBounds(data);

    let finalData = data, msg = 'WGS84 Coordinates.', statusType = 'SUCCESS';

    if (Math.abs(b.maxX) > 500 || Math.abs(b.maxY) > 500) {
        try {
            finalData = transformCoordinates(data, c => proj4('EPSG:3857', 'EPSG:4326', c));
            msg = 'EPSG:3857 detected and reprojected.'; statusType = 'WARNING';
            b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            findBounds(finalData);
        } catch { msg = 'Projection error.'; statusType = 'ERROR'; }
    } else if (b.maxY > 40 && b.maxY < 100 && b.maxX < 40) {
        finalData = transformCoordinates(data, c => [c[1], c[0]]);
        msg = 'Corrected swapped Lat/Long.'; statusType = 'WARNING';
        [b.minX, b.minY] = [b.minY, b.minX];[b.maxX, b.maxY] = [b.maxY, b.maxX];
    }

    let bounds = null;
    if (b.minX !== Infinity) {
        const latBuf = Math.abs(b.maxY - b.minY) < 0.001 ? 0.01 : 0;
        const lngBuf = Math.abs(b.maxX - b.minX) < 0.001 ? 0.01 : 0;
        bounds = [[b.minY - latBuf, b.minX - lngBuf], [b.maxY + latBuf, b.maxX + lngBuf]];
    }

    return { finalData, msg, statusType, bounds, hasFeatures: b.minX !== Infinity };
};

// ── Re-exports for backwards compatibility ────────────────────────────────
export { mutateGeometry, getVertexCoord } from './geometryOps';
export { findOverlapGroups } from './spatialIndex';
