"""
overlap_parser.py
-----------------
KML/KMZ reading and property extraction logic for the overlap pipeline.
Extracted from overlap_service.py to keep that class focused on orchestration.
"""
import os
import re
import json
import fiona
import pandas as pd
import geopandas as gpd
from zipfile import ZipFile


def ensure_kml_drivers():
    if 'KML' not in fiona.drvsupport.supported_drivers:
        fiona.drvsupport.supported_drivers['KML'] = 'rw'
    if 'LIBKML' not in fiona.drvsupport.supported_drivers:
        fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'


def read_kmz(file_path):
    """Reads KMZ or KML files using fiona/geopandas. Returns a GeoDataFrame."""
    ensure_kml_drivers()
    try:
        layers = fiona.listlayers(file_path)
        gdfs = [gpd.read_file(file_path, layer=layer, engine='fiona') for layer in layers]
        if not gdfs:
            return gpd.read_file(file_path, engine='fiona')
        return pd.concat(gdfs, ignore_index=True)
    except Exception:
        with ZipFile(file_path, 'r') as zh:
            kml_files = [f for f in zh.namelist() if f.lower().endswith('.kml')]
            if not kml_files:
                raise ValueError("No KML file found inside KMZ.")
            abs_path = os.path.abspath(file_path).replace("\\", "/")
            all_gdfs = []
            for kml_f in kml_files:
                zip_uri = f"zip://{abs_path}!{kml_f}"
                try:
                    all_gdfs.append(gpd.read_file(zip_uri, engine='fiona'))
                except Exception:
                    continue
            if not all_gdfs:
                return gpd.GeoDataFrame()
            return pd.concat(all_gdfs, ignore_index=True)


def find_in_desc(desc, keyword):
    """Extracts a value from a KML HTML description cell matching keyword."""
    if not desc or not isinstance(desc, str):
        return None
    try:
        t_match = re.search(
            rf'(?:<th>|<td>)[^<]*{keyword}[^<]*(?:</th>|</td>)\s*(?:<th>|<td>)(.*?)(?:</th>|</td>)',
            desc, re.IGNORECASE | re.DOTALL
        )
        if t_match and t_match.group(1):
            return re.sub('<[^>]+>', '', t_match.group(1)).strip()

        k_match = re.search(rf'{keyword}\s*[:=]\s*(.*?)(?:\\n|\n|$)', desc, re.IGNORECASE)
        if k_match and k_match.group(1):
            val = k_match.group(1).strip()
            val = re.sub('<[^>]+>', '', val)
            if not (val.startswith('[') or val.startswith('{')):
                val = val.replace('\\', '').strip(' "').replace('",', '').strip()
            else:
                val = val.strip().strip('"').strip("'").strip()
            return val
    except Exception:
        return None
    return None


def format_plants_data(raw_val):
    """Parses JSON-like plant data into (names_string, total_qty_string)."""
    if not raw_val or raw_val == "N/A":
        return "N/A", "N/A"

    try:
        names = re.findall(r'"name"\s*:\s*"([^"]*)"', str(raw_val))
        qtys  = re.findall(r'"quantity"\s*:\s*"([^"]*)"', str(raw_val))
        if names and qtys and len(names) == len(qtys):
            total = 0
            parts = []
            for n, q in zip(names, qtys):
                parts.append(f"{n} ({q})")
                try: total += int(float(q))
                except Exception: pass
            return ", ".join(parts), (str(total) if total > 0 else "N/A")

        data = None
        if isinstance(raw_val, str):
            clean = raw_val.strip()
            if clean.startswith("[{'") or clean.startswith("{'"):
                clean = clean.replace("'", '"')
            if clean.startswith('[') or clean.startswith('{'):
                try:
                    data = json.loads(clean)
                except json.JSONDecodeError:
                    fixed = re.sub(r'("[^"]*")\s*("[^"]*":)', r'\1,\2', clean)
                    try: data = json.loads(fixed)
                    except Exception: pass

        if not data and isinstance(raw_val, (list, dict)):
            data = raw_val

        if data:
            if isinstance(data, list):
                total, parts = 0, []
                for item in data:
                    name = item.get('name') or item.get('label') or "Unknown"
                    qty  = item.get('quantity') or item.get('qty') or item.get('count') or "0"
                    parts.append(f"{name} ({qty})")
                    try: total += int(float(str(qty)))
                    except Exception: pass
                return ", ".join(parts), (str(total) if total > 0 else "N/A")
            elif isinstance(data, dict):
                return f"{data.get('name','Unknown')} ({data.get('quantity','0')})", str(data.get('quantity', "0"))
    except Exception:
        pass

    return str(raw_val), "N/A"


def extract_details(properties, index, geom=None, calculate_area_ha_fn=None):
    """
    Builds an extraction dict from a feature's properties dict.
    Optionally computes geom_area if a geometry and area function are provided.
    """
    props = properties
    desc = props.get('description') or props.get('Description') or props.get('DESCRIPTION') or ""

    def _get(keys, desc_keys):
        for k in keys:
            v = props.get(k)
            if v and v != "N/A":
                return v
        for dk in desc_keys:
            v = find_in_desc(desc, dk)
            if v:
                return v
        return "N/A"

    pid  = _get(['Plantation ID', 'plantation_id', 'PlantationId', 'plantation id'],
                 ['Plantation ID', 'plantation_id'])
    pby  = _get(['Plantation By', 'plantation_by', 'Department', 'department', 'Plantation by'],
                 ['Plantation By', 'Department', 'plantation_by'])
    pn_raw = _get(['Plants Name', 'plants_name', 'Plant Name', 'plant_name', 'PlantsName', 'PlantName'],
                  ['Plants Name', 'Plant Name', 'plants_name'])

    pn, npc_calc = format_plants_data(pn_raw)

    npc = _get(['No of Plants', 'no_of_plants', 'No. of Plants', 'Number of Plants', 'count', 'Count'],
               ['No of Plants', 'No. of Plants', 'Number of Plants'])
    if npc == "N/A":
        npc = npc_calc

    area_val = _get(['Area', 'area', 'AREA'], ['Area'])
    cat      = _get(['Created At', 'created_at', 'CreatedAt', 'Date', 'date'],
                    ['Created At', 'Date', 'created_at'])
    fid      = (props.get('_id') or props.get('id') or props.get('OBJECTID') or
                props.get('NAME') or props.get('name') or
                (pid if pid != "N/A" else f"Feature_{index}"))

    geom_area = 0.0
    if geom and calculate_area_ha_fn:
        geom_area = calculate_area_ha_fn(geom)
    else:
        try:
            raw = props.get('_geom_area')
            if raw is not None:
                geom_area = float(raw)
        except (ValueError, TypeError):
            pass

    if geom_area <= 0 and area_val and area_val != "N/A":
        try:
            matches = re.findall(r'(\d+\.?\d*)', str(area_val))
            if matches:
                geom_area = float(matches[0])
        except Exception:
            pass

    return {
        "_id": fid, "pid": pid, "pby": pby, "cat": cat,
        "pn": pn, "npc": npc, "area": area_val, "geom_area": geom_area
    }
