const formatPlantsData = (rawVal) => {
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
};

const t1 = [{ "id": 28, "name": "Jamun (जामुन)", "quantity": "50" }, { "id": 52, "name": "Lemon (नींबू)", "quantity": "70" }];
console.log("t1 json obj:", formatPlantsData(t1));

const t2 = '[{"id":28,"name":"Jamun (जामुन)","quantity":"50"}, {"id":52,"name":"Lemon (नींबू)","quantity":"70"}]';
console.log("t2 string:", formatPlantsData(t2));

