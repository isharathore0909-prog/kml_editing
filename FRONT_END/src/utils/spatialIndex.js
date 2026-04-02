/**
 * spatialIndex.js
 * RBush-backed spatial grouping utilities.
 */
import RBush from 'rbush';
import bbox from '@turf/bbox';
import booleanIntersects from '@turf/boolean-intersects';

/**
 * Finds connected groups of overlapping features using a spatial index.
 * Returns an array of Sets, where each Set contains the _id values of features
 * that overlap directly or transitively.
 *
 * @param {Array} features - GeoJSON feature objects.
 * @returns {Array<Set<string>>}
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

    for (const item of items) {
        if (processedIds.has(item.id)) continue;

        const group = new Set();
        const stack = [item];
        processedIds.add(item.id);

        while (stack.length > 0) {
            const current = stack.pop();
            group.add(current.id);

            for (const candidate of tree.search(current)) {
                if (processedIds.has(candidate.id)) continue;
                if (booleanIntersects(current.feature, candidate.feature)) {
                    processedIds.add(candidate.id);
                    stack.push(candidate);
                }
            }
        }

        if (group.size > 1) groups.push(group);
    }

    return groups;
};
