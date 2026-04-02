import proj4 from 'proj4';
import RBush from 'rbush';
import bbox from '@turf/bbox';
import booleanIntersects from '@turf/boolean-intersects';

// Common projections
proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs");

export const transformCoordinates = (data, transformFn) => {
    const newData = JSON.parse(JSON.stringify(data));

    const processCoords = (coords) => {
        if (typeof coords[0] === 'number') {
            return transformFn(coords);
        }
        return coords.map(processCoords);
    };

    const processFeature = (feature) => {
        if (!feature.geometry) return feature;

        const transformGeom = (geom) => {
            if (geom.type === 'GeometryCollection') {
                if (geom.geometries) {
                    geom.geometries.forEach(transformGeom);
                }
            } else if (geom.coordinates) {
                geom.coordinates = processCoords(geom.coordinates);
            }
        };

        transformGeom(feature.geometry);
        return feature;
    };

    if (newData.type === 'FeatureCollection') {
        newData.features = newData.features.map(processFeature);
    } else if (newData.type === 'Feature') {
        processFeature(newData);
    } else if (newData && newData.geometry && newData.geometry.coordinates) {
        newData.geometry.coordinates = processCoords(newData.geometry.coordinates);
    }

    return newData;
};

export const analyzeGeoData = (data) => {
    if (!data) return { finalData: null, msg: "No data found", statusType: 'ERROR', bounds: null, hasFeatures: false };

    let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    // High-performance recursive bounds finding
    const findBoundsRecursive = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            if (typeof obj[0] === 'number' && typeof obj[1] === 'number') {
                const x = obj[0];
                const y = obj[1];

                // CRITICAL: Ignore "Zero-Islands" or incomplete coordinates (0.0, 0.0)
                // In GIS exports, 0 is almost always a placeholder for missing data.
                if (Math.abs(x) < 0.0000001 || Math.abs(y) < 0.0000001) return;

                if (x < bounds.minX) bounds.minX = x;
                if (x > bounds.maxX) bounds.maxX = x;
                if (y < bounds.minY) bounds.minY = y;
                if (y > bounds.maxY) bounds.maxY = y;
            } else {
                for (let i = 0; i < obj.length; i++) {
                    findBoundsRecursive(obj[i]);
                }
            }
        } else {
            if (obj.features) findBoundsRecursive(obj.features);
            else if (obj.geometry) findBoundsRecursive(obj.geometry);
            else if (obj.geometries) findBoundsRecursive(obj.geometries);
            else if (obj.coordinates) findBoundsRecursive(obj.coordinates);
            else if (obj.type === 'Feature') findBoundsRecursive(obj.geometry);
        }
    };

    findBoundsRecursive(data);

    let finalData = data;
    let msg = "WGS84 Coordinates.";
    let statusType = 'SUCCESS';

    // 1. Detect Web Mercator (Meters)
    if (Math.abs(bounds.maxX) > 500 || Math.abs(bounds.maxY) > 500) {
        try {
            finalData = transformCoordinates(data, (c) => proj4("EPSG:3857", "EPSG:4326", c));
            msg = "EPSG:3857 detected and reprojected.";
            statusType = 'WARNING';
            // Recalculate
            bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            findBoundsRecursive(finalData);
        } catch (e) {
            msg = "Projection error.";
            statusType = 'ERROR';
        }
    }
    // 2. Detect Swapped Lat/Long for India
    // Lng: 68-98, Lat: 8-38
    else if (bounds.maxY > 40 && bounds.maxY < 100 && bounds.maxX < 40) {
        finalData = transformCoordinates(data, (c) => [c[1], c[0]]);
        msg = "Corrected swapped Lat/Long.";
        statusType = 'WARNING';
        // Swap bounds locally
        const tMin = bounds.minX; bounds.minX = bounds.minY; bounds.minY = tMin;
        const tMax = bounds.maxX; bounds.maxX = bounds.maxY; bounds.maxY = tMax;
    }

    let boundsArray = null;
    if (bounds.minX !== Infinity) {
        // Handle precision errors and single points
        const latBuffer = Math.abs(bounds.maxY - bounds.minY) < 0.001 ? 0.01 : 0;
        const lngBuffer = Math.abs(bounds.maxX - bounds.minX) < 0.001 ? 0.01 : 0;

        boundsArray = [
            [bounds.minY - latBuffer, bounds.minX - lngBuffer],
            [bounds.maxY + latBuffer, bounds.maxX + lngBuffer]
        ];
    }

    return {
        finalData,
        msg,
        statusType,
        bounds: boundsArray,
        hasFeatures: bounds.minX !== Infinity
    };
};

/**
 * Mutates a GeoJSON geometry object based on a path and new position.
 * @param {Object} geom - The GeoJSON geometry.
 * @param {Object} p - Path params (vertex_index, ring_index, part_index).
 * @param {Array} pos - [lng, lat]
 */
export const mutateGeometry = (geom, p, pos) => {
    // Safety check: ensure pos is an iterable array with [lng, lat]
    if (!pos || !Array.isArray(pos) || pos.length < 2) {
        console.warn('mutateGeometry called with invalid pos:', pos);
        return;
    }
    const [lng, lat] = pos;

    const applyToGeom = (g) => {
        if (g.type === 'Point') {
            g.coordinates = [lng, lat];
        } else if (g.type === 'MultiPoint' || g.type === 'LineString') {
            if (g.coordinates[p.vertex_index]) g.coordinates[p.vertex_index] = [lng, lat];
        } else if (g.type === 'Polygon') {
            const ring = g.coordinates[p.ring_index ?? 0];
            if (ring && ring[p.vertex_index] !== undefined) {
                ring[p.vertex_index] = [lng, lat];
                if (p.vertex_index === 0) ring[ring.length - 1] = [lng, lat];
                if (p.vertex_index === ring.length - 1) ring[0] = [lng, lat];
            }
        } else if (g.type === 'MultiLineString') {
            const line = g.coordinates[p.part_index ?? 0];
            if (line && line[p.vertex_index] !== undefined) line[p.vertex_index] = [lng, lat];
        } else if (g.type === 'MultiPolygon') {
            const poly = g.coordinates[p.part_index ?? 0];
            const ring = poly ? poly[p.ring_index ?? 0] : null;
            if (ring && ring[p.vertex_index] !== undefined) {
                ring[p.vertex_index] = [lng, lat];
                if (p.vertex_index === 0) ring[ring.length - 1] = [lng, lat];
                if (p.vertex_index === ring.length - 1) ring[0] = [lng, lat];
            }
        } else if (g.type === 'GeometryCollection') {
            const sub = g.geometries[p.part_index ?? 0];
            if (sub) applyToGeom(sub);
        }
    };
    applyToGeom(geom);
};

/**
 * Extracts a vertex coordinate from a GeoJSON geometry object based on a path.
 * @param {Object} geom - The GeoJSON geometry.
 * @param {Object} p - Path params.
 * @returns {Array|null} [lng, lat]
 */
export const getVertexCoord = (geom, p) => {
    if (geom.type === 'Point') return geom.coordinates;
    if (geom.type === 'MultiPoint' || geom.type === 'LineString') return geom.coordinates[p.vertex_index];
    if (geom.type === 'Polygon') return (geom.coordinates[p.ring_index ?? 0] || [])[p.vertex_index];
    if (geom.type === 'MultiLineString') return (geom.coordinates[p.part_index ?? 0] || [])[p.vertex_index];
    if (geom.type === 'MultiPolygon') {
        const poly = geom.coordinates[p.part_index ?? 0] || [];
        const ring = poly[p.ring_index ?? 0] || [];
        return ring[p.vertex_index];
    }
    return null;
};

/**
 * Finds groups of overlapping features using a spatial index (RBush).
 * Returns an array of sets, where each set contains feature IDs that overlap directly or indirectly.
 * @param {Array} features - GeoJSON features.
 * @returns {Array<Set>}
 */
export const findOverlapGroups = (features) => {
    if (!features || features.length === 0) return [];

    const tree = new RBush();
    const items = features.map(f => {
        const [minX, minY, maxX, maxY] = bbox(f);
        return { minX, minY, maxX, maxY, id: f._id, feature: f };
    });
    tree.load(items);

    const groups = [];
    const processedIds = new Set();

    items.forEach(item => {
        if (processedIds.has(item.id)) return;

        const currentGroup = new Set();
        const stack = [item];
        processedIds.add(item.id);

        while (stack.length > 0) {
            const current = stack.pop();
            currentGroup.add(current.id);

            // Find all potential overlaps in the spatial index
            const potentials = tree.search(current);

            potentials.forEach(p => {
                if (processedIds.has(p.id)) return;

                // Perform actual geometric intersection check
                if (booleanIntersects(current.feature, p.feature)) {
                    processedIds.add(p.id);
                    stack.push(p);
                }
            });
        }

        if (currentGroup.size > 1) {
            groups.push(currentGroup);
        }
    });

    return groups;
};
