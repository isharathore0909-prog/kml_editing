/**
 * geometryOps.js
 * Pure vertex-level geometry mutation and extraction helpers.
 * No external dependencies beyond GeoJSON type conventions.
 */

/**
 * Mutates a GeoJSON geometry object in-place based on a vertex path and new position.
 * @param {Object} geom - A GeoJSON geometry object.
 * @param {Object} p    - Path: { vertex_index, ring_index?, part_index? }
 * @param {Array}  pos  - [lng, lat]
 */
export const mutateGeometry = (geom, p, pos) => {
    if (!pos || !Array.isArray(pos) || pos.length < 2) {
        console.warn('mutateGeometry: invalid pos', pos);
        return;
    }
    const [lng, lat] = pos;

    const apply = (g) => {
        switch (g.type) {
            case 'Point':
                g.coordinates = [lng, lat];
                break;
            case 'MultiPoint':
            case 'LineString':
                if (g.coordinates[p.vertex_index]) g.coordinates[p.vertex_index] = [lng, lat];
                break;
            case 'Polygon': {
                const ring = g.coordinates[p.ring_index ?? 0];
                if (ring && ring[p.vertex_index] !== undefined) {
                    ring[p.vertex_index] = [lng, lat];
                    if (p.vertex_index === 0) ring[ring.length - 1] = [lng, lat];
                    if (p.vertex_index === ring.length - 1) ring[0] = [lng, lat];
                }
                break;
            }
            case 'MultiLineString': {
                const line = g.coordinates[p.part_index ?? 0];
                if (line && line[p.vertex_index] !== undefined) line[p.vertex_index] = [lng, lat];
                break;
            }
            case 'MultiPolygon': {
                const poly = g.coordinates[p.part_index ?? 0];
                const ring2 = poly ? poly[p.ring_index ?? 0] : null;
                if (ring2 && ring2[p.vertex_index] !== undefined) {
                    ring2[p.vertex_index] = [lng, lat];
                    if (p.vertex_index === 0) ring2[ring2.length - 1] = [lng, lat];
                    if (p.vertex_index === ring2.length - 1) ring2[0] = [lng, lat];
                }
                break;
            }
            case 'GeometryCollection': {
                const sub = g.geometries[p.part_index ?? 0];
                if (sub) apply(sub);
                break;
            }
            default: break;
        }
    };
    apply(geom);
};

/**
 * Extracts a vertex coordinate from a GeoJSON geometry object.
 * @param {Object} geom
 * @param {Object} p    - Path: { vertex_index, ring_index?, part_index? }
 * @returns {Array|null} [lng, lat]
 */
export const getVertexCoord = (geom, p) => {
    switch (geom.type) {
        case 'Point': return geom.coordinates;
        case 'MultiPoint':
        case 'LineString': return geom.coordinates[p.vertex_index];
        case 'Polygon': return (geom.coordinates[p.ring_index ?? 0] || [])[p.vertex_index];
        case 'MultiLineString': return (geom.coordinates[p.part_index ?? 0] || [])[p.vertex_index];
        case 'MultiPolygon': {
            const poly = geom.coordinates[p.part_index ?? 0] || [];
            return (poly[p.ring_index ?? 0] || [])[p.vertex_index];
        }
        default: return null;
    }
};
