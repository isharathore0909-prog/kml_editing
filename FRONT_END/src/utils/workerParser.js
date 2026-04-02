/**
 * workerParser.js
 * Pure, side-effect-free parsing helpers used by geoWorker.js.
 * Extracted so they can be tested independently without a Worker context.
 */

/**
 * Parses raw plant data (JSON string or object) into display-ready strings.
 * @param {string|Array|Object} rawVal
 * @returns {{ pn: string, npc: string }}
 */
export function formatPlantsData(rawVal) {
    if (!rawVal || rawVal === 'N/A') return { pn: 'N/A', npc: 'N/A' };

    try {
        const strVal = String(rawVal);
        const nameMatches = Array.from(strVal.matchAll(/"name"\s*:\s*"([^"]*)"/g));
        const qtyMatches = Array.from(strVal.matchAll(/"quantity"\s*:\s*"([^"]*)"/g));

        if (nameMatches.length > 0 && nameMatches.length === qtyMatches.length) {
            let totalQty = 0;
            const pn = nameMatches.map((m, i) => {
                const qty = qtyMatches[i][1];
                totalQty += Number(qty) || 0;
                return `${m[1]} (${qty})`;
            }).join(', ');
            return { pn, npc: totalQty > 0 ? String(totalQty) : 'N/A' };
        }

        let data = null;
        if (typeof rawVal === 'string') {
            let clean = rawVal.trim();
            if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1).trim();
            if (clean.startsWith('[') || clean.startsWith('{')) {
                try { data = JSON.parse(clean); }
                catch { try { data = JSON.parse(clean.replace(/(\"[^\"]*\")\s*(\"[^\"]*\":)/g, '$1,$2')); } catch { } }
            }
        }
        if (!data && rawVal !== null && typeof rawVal === 'object') data = rawVal;

        if (data) {
            if (Array.isArray(data)) {
                let total = 0;
                const pn = data.map(item => {
                    const qty = item.quantity || item.qty || item.count || '0';
                    total += Number(qty) || 0;
                    return `${item.name || item.label || 'Unknown'} (${qty})`;
                }).join(', ');
                return { pn, npc: total > 0 ? String(total) : 'N/A' };
            } else if (typeof data === 'object') {
                return { pn: `${data.name || 'Unknown'} (${data.quantity || '0'})`, npc: String(data.quantity || '0') };
            }
        }
    } catch { }
    return { pn: String(rawVal), npc: 'N/A' };
}

/**
 * Extracts display-ready details from a GeoJSON feature.
 * @param {Object} feat     - GeoJSON feature
 * @param {number} index    - Feature index (used as fallback ID)
 * @param {number} geomArea - Pre-computed area in hectares
 * @returns {Object}
 */
export function extractFeatureDetails(feat, index, geomArea) {
    const props = feat.properties || {};
    let desc = props.description || props.Description || props.DESCRIPTION || '';

    if (typeof desc === 'object' && desc !== null && desc.value) {
        desc = desc.value;
    } else if (typeof desc === 'string' && desc.trim().startsWith('{')) {
        try { const p = JSON.parse(desc); if (p?.value) desc = p.value; } catch { }
    }

    const findInDesc = (keyword) => {
        if (!desc || typeof desc !== 'string') return null;
        try {
            const tmatch = new RegExp(
                `(?:<th>|<td>)[^<]*${keyword}[^<]*(?:</th>|</td>)\\s*(?:<th>|<td>)(.*?)(?:</th>|</td>)`, 'is'
            ).exec(desc);
            if (tmatch?.[1]) return tmatch[1].replace(/<[^>]+>/g, '').trim();

            const kmatch = new RegExp(`${keyword}\\s*[:=]\\s*(.*?)(?:\\\\n|\\n|$)`, 'i').exec(desc);
            if (kmatch?.[1]) {
                let val = kmatch[1].replace(/<[^>]+>/g, '').trim();
                if (!(val.startsWith('[') || val.startsWith('{'))) {
                    val = val.replace(/\\/g, '').replace(/^"|"$/g, '').replace(/",?$/, '').trim();
                }
                return val || null;
            }
        } catch { }
        return null;
    };

    const get = (propKeys, descKeys) => {
        for (const k of propKeys) if (props[k]) return props[k];
        for (const k of descKeys) { const v = findInDesc(k); if (v) return v; }
        return null;
    };

    const pid = get(['Plantation ID', 'plantation_id', 'PlantationId', 'plantation id'], ['Plantation ID', 'plantation_id', 'id']) || 'N/A';
    const pby = get(['Plantation By', 'plantation_by', 'Department', 'department', 'Plantation by'], ['Plantation By Department', 'Plantation By', 'Department', 'plantation_by']) || 'N/A';
    const cat = get(['Created At', 'created_at', 'CreatedAt', 'Date', 'date'], ['Created At', 'Date', 'created_at']) || 'N/A';
    const pnRaw = get(['Plants Name', 'plants_name', 'Plant Name', 'plant_name', 'PlantsName', 'PlantName'], ['Plants Name', 'Plant Name', 'plants_name']) || 'N/A';

    const { pn, npc: npcCalc } = formatPlantsData(pnRaw);

    const npc = get(['No of Plants', 'no_of_plants', 'No. of Plants', 'Number of Plants', 'count', 'Count'], ['No of Plants', 'No. of Plants', 'Number of Plants']) || (npcCalc !== 'N/A' ? npcCalc : 'N/A');
    const area_val = get(['Area', 'area', 'AREA'], ['Area']) || 'N/A';
    const featureId = props.id || props.OBJECTID || props.NAME || props.name || (pid !== 'N/A' ? pid : `Feature_${index}`);

    return { id: featureId, pid, pby, cat, pn, npc, area: area_val, geom_area: geomArea || 0 };
}
