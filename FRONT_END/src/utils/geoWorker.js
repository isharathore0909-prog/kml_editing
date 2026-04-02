import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';
import JSZip from 'jszip';
import { analyzeGeoData } from './geoUtils.js';
import bbox from '@turf/bbox';
import booleanIntersects from '@turf/boolean-intersects';
import area from '@turf/area';
import intersect from '@turf/intersect';
import { featureCollection } from '@turf/helpers';
import RBush from 'rbush';

function formatPlantsData(rawVal) {
    if (!rawVal || rawVal === "N/A") return { pn: "N/A", npc: "N/A" };

    try {
        const strVal = String(rawVal);

        // Regex extraction is most robust for malformed JSON as seen in screenshots
        const nameMatches = Array.from(strVal.matchAll(/"name"\s*:\s*"([^"]*)"/g));
        const qtyMatches = Array.from(strVal.matchAll(/"quantity"\s*:\s*"([^"]*)"/g));

        if (nameMatches.length > 0 && nameMatches.length === qtyMatches.length) {
            let totalQty = 0;
            const pn = nameMatches.map((m, i) => {
                const name = m[1];
                const qty = qtyMatches[i][1];
                totalQty += Number(qty) || 0;
                return `${name} (${qty})`;
            }).join(', ');
            return { pn, npc: totalQty > 0 ? String(totalQty) : "N/A" };
        }

        // Fallback to JSON parsing
        let data = null;
        if (typeof rawVal === 'string') {
            let cleanVal = rawVal.trim();
            if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
                cleanVal = cleanVal.substring(1, cleanVal.length - 1).trim();
            }

            if (cleanVal.startsWith('[') || cleanVal.startsWith('{')) {
                try {
                    data = JSON.parse(cleanVal);
                } catch (e) {
                    const fixedVal = cleanVal.replace(/("[^"]*")\s*("[^"]*":)/g, '$1,$2');
                    try {
                        data = JSON.parse(fixedVal);
                    } catch (ignore) { }
                }
            }
        }

        if (!data && typeof rawVal === 'object' && rawVal !== null) {
            data = rawVal;
        }

        if (data) {
            if (Array.isArray(data)) {
                let totalQty = 0;
                const pn = data.map(item => {
                    const name = item.name || item.label || "Unknown";
                    const qty = item.quantity || item.qty || item.count || "0";
                    totalQty += Number(qty) || 0;
                    return `${name} (${qty})`;
                }).join(', ');
                return { pn, npc: totalQty > 0 ? String(totalQty) : "N/A" };
            } else if (typeof data === 'object') {
                const name = data.name || "Unknown";
                const qty = data.quantity || "0";
                return { pn: `${name} (${qty})`, npc: String(qty) };
            }
        }
    } catch (e) { }
    return { pn: String(rawVal), npc: "N/A" };
}

function extractFeatureDetails(feat, index, geomArea) {
    const props = feat.properties || {};
    let desc = props.description || props.Description || props.DESCRIPTION || "";

    // Handle edge case where Description is actually a stringified JSON object containing a "value" parameter
    if (typeof desc === 'object' && desc !== null && desc.value) {
        desc = desc.value;
    } else if (typeof desc === 'string' && desc.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(desc);
            if (parsed && parsed.value) {
                desc = parsed.value;
            }
        } catch (e) {
            // ignore JSON parse errors
        }
    }

    let pid = props['Plantation ID'] || props['plantation_id'] || props['PlantationId'] || props['plantation id'] || null;
    let pby = props['Plantation By'] || props['plantation_by'] || props['Department'] || props['department'] || props['Plantation by'] || null;
    let cat = props['Created At'] || props['created_at'] || props['CreatedAt'] || props['Date'] || props['date'] || null;

    const findInDesc = (keyword) => {
        if (!desc || typeof desc !== 'string') return null;
        try {
            // Match inside an HTML table often exported by ArcGIS / QGIS
            let tmatch = new RegExp(`(?:<th>|<td>)[^<]*${keyword}[^<]*(?:</th>|</td>)\\s*(?:<th>|<td>)(.*?)(?:</th>|</td>)`, 'is').exec(desc);
            if (tmatch && tmatch[1]) return tmatch[1].replace(/<[^>]+>/g, '').trim();

            // Match "Key: Value" or "Key=Value" formats up to literal \n or end of string
            // Handle unescaped \n strings which are present in the provided screenshot: "\n Plantation ID: BLOCK-133206 \n"
            let kmatch = new RegExp(`${keyword}\\s*[:=]\\s*(.*?)(?:\\\\n|\\n|$)`, 'i').exec(desc);
            if (kmatch && kmatch[1]) {
                let val = kmatch[1].trim();
                // Cleanup HTML
                val = val.replace(/<[^>]+>/g, '').trim();

                // If it's not JSON, do the aggressive cleanup
                if (!(val.startsWith('[') || val.startsWith('{'))) {
                    val = val.replace(/\\/g, '').replace(/^"|"$/g, '').replace(/",?$/, '').trim();
                }
                return val;
            }
        } catch (e) {
            return null;
        }
        return null;
    };

    if (!pid) pid = findInDesc('Plantation ID') || findInDesc('plantation_id') || findInDesc('id') || "N/A";
    if (!pby) pby = findInDesc('Plantation By Department') || findInDesc('Plantation By') || findInDesc('Department') || findInDesc('plantation_by') || "N/A";
    if (!cat) cat = findInDesc('Created At') || findInDesc('Date') || findInDesc('created_at') || "N/A";

    let pnRaw = props['Plants Name'] || props['plants_name'] || props['Plant Name'] || props['plant_name'] || props['PlantsName'] || props['PlantName'] || null;
    if (!pnRaw) pnRaw = findInDesc('Plants Name') || findInDesc('Plant Name') || findInDesc('plants_name') || "N/A";

    const { pn, npc: npcCalc } = formatPlantsData(pnRaw);

    let npc = props['No of Plants'] || props['no_of_plants'] || props['No. of Plants'] || props['Number of Plants'] || props['count'] || props['Count'] || null;
    if (!npc) npc = findInDesc('No of Plants') || findInDesc('No. of Plants') || findInDesc('Number of Plants') || (npcCalc !== "N/A" ? npcCalc : "N/A");

    let area_val = props['Area'] || props['area'] || props['AREA'] || null;
    if (!area_val) area_val = findInDesc('Area') || "N/A";

    const featureId = props.id || props.OBJECTID || props.NAME || props.name || (pid !== "N/A" ? pid : `Feature_${index}`);

    return {
        id: featureId,
        pid,
        pby,
        cat,
        pn,
        npc,
        area: area_val,
        geom_area: geomArea || 0
    };
}

self.onmessage = async function (e) {
    const { file, name } = e.data;
    const fileName = (name || '').toLowerCase();

    try {
        let geojson = null;

        if (fileName.endsWith('.kml')) {
            const text = await file.text();
            const dom = new DOMParser().parseFromString(text, 'text/xml');
            geojson = kml(dom);
        } else if (fileName.endsWith('.kmz')) {
            const arrayBuffer = await file.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);

            // Find all KML files inside KMZ
            const files = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.kml'));

            if (files.length === 0) {
                throw new Error("No KML file found inside the KMZ archive.");
            }

            let allFeatures = [];
            for (const kmlFileObj of files) {
                const kmlText = await kmlFileObj.async('text');
                const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
                const parsed = kml(dom);
                if (parsed && parsed.features) {
                    allFeatures.push(...parsed.features);
                }
            }

            geojson = {
                type: 'FeatureCollection',
                features: allFeatures
            };
        } else {
            const text = await file.text();
            geojson = JSON.parse(text);
        }

        self.postMessage({ type: 'STATUS', message: 'Analyzing geometry and coordinate system...' });
        const analysis = analyzeGeoData(geojson);

        if (!analysis.hasFeatures) {
            throw new Error("No geometric data found in this file. Please check if the file contains valid coordinates.");
        }

        const { finalData, msg, statusType, bounds } = analysis;
        self.postMessage({ type: 'STATUS', message: `Visuals ready (${msg})` });

        // Ensure every feature has a unique internal ID and normalized properties
        if (finalData && finalData.features) {
            finalData.features.forEach((f, i) => {
                // Normalize properties for consistent display and searching
                const details = extractFeatureDetails(f, i);
                f.properties = { ...f.properties, ...details };
                f._id = f._id || `feat-${Date.now()}-${i}`;
            });
        }

        self.postMessage({
            type: 'SUCCESS',
            result: {
                originalData: geojson,
                finalData,
                msg,
                statusType,
                bounds
            }
        });
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message || "Failed to parse file",
        });
    }
};
