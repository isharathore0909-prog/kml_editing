/**
 * geoWorker.js — Web Worker entry point
 * All parsing helpers live in workerParser.js.
 * This file only handles the Worker message protocol.
 */
import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';
import JSZip from 'jszip';
import { analyzeGeoData } from './geoUtils.js';
import { extractFeatureDetails } from './workerParser.js';

self.onmessage = async function (e) {
    const { file, name } = e.data;
    const fileName = (name || '').toLowerCase();

    try {
        let geojson = null;

        if (fileName.endsWith('.kml')) {
            const text = await file.text();
            geojson = kml(new DOMParser().parseFromString(text, 'text/xml'));

        } else if (fileName.endsWith('.kmz')) {
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const kmlFiles = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.kml'));
            if (kmlFiles.length === 0) throw new Error('No KML file found inside the KMZ archive.');

            const allFeatures = [];
            for (const kmlFile of kmlFiles) {
                const parsed = kml(new DOMParser().parseFromString(await kmlFile.async('text'), 'text/xml'));
                if (parsed?.features) allFeatures.push(...parsed.features);
            }
            geojson = { type: 'FeatureCollection', features: allFeatures };

        } else {
            geojson = JSON.parse(await file.text());
        }

        self.postMessage({ type: 'STATUS', message: 'Analyzing geometry and coordinate system...' });
        const analysis = analyzeGeoData(geojson);

        if (!analysis.hasFeatures) {
            throw new Error('No geometric data found in this file. Please check if the file contains valid coordinates.');
        }

        const { finalData, msg, statusType, bounds } = analysis;
        self.postMessage({ type: 'STATUS', message: `Visuals ready (${msg})` });

        // Assign unique IDs and normalize properties
        if (finalData?.features) {
            finalData.features.forEach((f, i) => {
                const details = extractFeatureDetails(f, i);
                f.properties = { ...f.properties, ...details };
                f._id = f._id || `feat-${Date.now()}-${i}`;
            });
        }

        self.postMessage({ type: 'SUCCESS', result: { originalData: geojson, finalData, msg, statusType, bounds } });
    } catch (error) {
        self.postMessage({ type: 'ERROR', error: error.message || 'Failed to parse file' });
    }
};
