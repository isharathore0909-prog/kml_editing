import geopandas as gpd
import fiona
import os
import pandas as pd
from shapely.ops import unary_union, transform
from zipfile import ZipFile
import re
import json

# Enable KML/KMZ drivers in fiona
fiona.drvsupport.supported_drivers['KML'] = 'rw'
fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'

def read_kmz(file_path):
    """ Reads KMZ or KML files using fiona. Handles zip URIs for KMZ. """
    try:
        # Check if fiona has drivers enabled
        if 'KML' not in fiona.drvsupport.supported_drivers:
            fiona.drvsupport.supported_drivers['KML'] = 'rw'
        if 'LIBKML' not in fiona.drvsupport.supported_drivers:
            fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'

        # Try reading all layers (some KMZs have multiple)
        layers = fiona.listlayers(file_path)
        gdfs = []
        for layer in layers:
            gdfs.append(gpd.read_file(file_path, layer=layer))
        if not gdfs:
             return gpd.read_file(file_path)
        return pd.concat(gdfs, ignore_index=True)
    except Exception as e:
        print(f"Layered read failed, searching zip contents: {e}")
        with ZipFile(file_path, 'r') as zh:
            kml_files = [f for f in zh.namelist() if f.lower().endswith('.kml')]
            if not kml_files:
                raise ValueError("No KML file found inside KMZ.")
            
            # Combine all KML files found in the zip
            all_gdfs = []
            abs_path = os.path.abspath(file_path).replace("\\", "/")
            for kml_f in kml_files:
                zip_uri = f"zip://{abs_path}!{kml_f}"
                try:
                    all_gdfs.append(gpd.read_file(zip_uri))
                except:
                    continue
            if not all_gdfs:
                return gpd.DataFrame()
            return pd.concat(all_gdfs, ignore_index=True)

def find_in_desc(desc, keyword):
    """ Helper to extract values from KML description string using regex. """
    if not desc or not isinstance(desc, str):
        return None
    try:
        # 1. Match inside an HTML table often exported by ArcGIS / QGIS
        t_pattern = rf'(?:<th>|<td>)[^<]*{keyword}[^<]*(?:</th>|</td>)\s*(?:<th>|<td>)(.*?)(?:</th>|</td>)'
        t_match = re.search(t_pattern, desc, re.IGNORECASE | re.DOTALL)
        if t_match and t_match.group(1):
            return re.sub('<[^>]+>', '', t_match.group(1)).strip()

        # 2. Match "Key: Value" or "Key=Value" formats
        k_pattern = rf'{keyword}\s*[:=]\s*(.*?)(?:\\n|\n|$)'
        k_match = re.search(k_pattern, desc, re.IGNORECASE)
        if k_match and k_match.group(1):
            val = k_match.group(1).strip()
            # Cleanup HTML
            val = re.sub('<[^>]+>', '', val)
            
            # If it doesn't look like JSON, do the aggressive cleanup
            if not (val.startswith('[') or val.startswith('{')):
                val = val.replace('\\', '').strip(' "').replace('",', '').strip()
            else:
                # For JSON, just strip surrounding quotes if they exist (sometimes from ArcGIS exports)
                val = val.strip().strip('"').strip("'").strip()
            return val
    except Exception:
        return None
    return None

def format_plants_data(raw_val):
    """ Parses JSON-like plant data into a readable string using regex or JSON parsing. """
    if not raw_val or raw_val == "N/A":
        return "N/A", "N/A"
    
    try:
        # Regex extraction is most robust for malformed JSON as seen in screenshots
        # Pattern handles "name":"Others ()" and "quantity":"100" even if commas are missing
        names = re.findall(r'"name"\s*:\s*"([^"]*)"', str(raw_val))
        qtys = re.findall(r'"quantity"\s*:\s*"([^"]*)"', str(raw_val))
        
        if names and qtys and len(names) == len(qtys):
            parts = []
            total_qty = 0
            for n, q in zip(names, qtys):
                parts.append(f"{n} ({q})")
                try:
                    total_qty += int(float(str(q)))
                except:
                    pass
            return ", ".join(parts), (str(total_qty) if total_qty > 0 else "N/A")

        # Fallback to standard JSON parsing if regex didn't yield pairs
        data = None
        if isinstance(raw_val, str):
            clean_val = raw_val.strip()
            if clean_val.startswith("[{'") or clean_val.startswith("{'"):
                clean_val = clean_val.replace("'", '"')
            
            if clean_val.startswith('[') or clean_val.startswith('{'):
                try:
                    data = json.loads(clean_val)
                except json.JSONDecodeError:
                    # Fix missing commas between key-value pairs
                    fixed_val = re.sub(r'("[^"]*")\s*("[^"]*":)', r'\1,\2', clean_val)
                    try:
                        data = json.loads(fixed_val)
                    except:
                        pass
        
        if not data and isinstance(raw_val, (list, dict)):
            data = raw_val
        
        if data:
            if isinstance(data, list):
                parts = []
                total_qty = 0
                for item in data:
                    name = item.get('name') or item.get('label') or "Unknown"
                    qty = item.get('quantity') or item.get('qty') or item.get('count') or "0"
                    parts.append(f"{name} ({qty})")
                    try:
                        total_qty += int(float(str(qty)))
                    except:
                        pass
                return ", ".join(parts), (str(total_qty) if total_qty > 0 else "N/A")
            elif isinstance(data, dict):
                 name = data.get('name') or "Unknown"
                 qty = data.get('quantity') or "0"
                 return f"{name} ({qty})", str(qty)
    except Exception:
        pass
    
    return str(raw_val), "N/A"

def extract_details(properties, index):
    """ Helper to extract details from properties, including parsing from Description. """
    props = properties
    desc = props.get('description') or props.get('Description') or props.get('DESCRIPTION') or ""
    
    # Try direct property lookup first
    pid = (props.get('Plantation ID') or props.get('plantation_id') or 
           props.get('PlantationId') or props.get('plantation id'))
    # Fallback to description parsing
    if not pid or pid == "N/A": 
        pid = find_in_desc(desc, 'Plantation ID') or find_in_desc(desc, 'plantation_id') or "N/A"

    pby = (props.get('Plantation By') or props.get('plantation_by') or 
           props.get('Department') or props.get('department') or 
           props.get('Plantation by'))
    if not pby or pby == "N/A": 
        pby = find_in_desc(desc, 'Plantation By') or find_in_desc(desc, 'Department') or find_in_desc(desc, 'plantation_by') or "N/A"

    pn_raw = (props.get('Plants Name') or props.get('plants_name') or 
              props.get('Plant Name') or props.get('plant_name') or
              props.get('PlantsName') or props.get('PlantName'))
    if not pn_raw or pn_raw == "N/A":
        pn_raw = find_in_desc(desc, 'Plants Name') or find_in_desc(desc, 'Plant Name') or find_in_desc(desc, 'plants_name') or "N/A"

    pn, npc_calc = format_plants_data(pn_raw)

    npc = (props.get('No of Plants') or props.get('no_of_plants') or 
           props.get('No. of Plants') or props.get('Number of Plants') or
           props.get('count') or props.get('Count'))
    if not npc or npc == "N/A":
        npc = find_in_desc(desc, 'No of Plants') or find_in_desc(desc, 'No. of Plants') or find_in_desc(desc, 'Number of Plants') or npc_calc or "N/A"

    area_val = (props.get('Area') or props.get('area') or props.get('AREA'))
    if not area_val or area_val == "N/A":
        area_val = find_in_desc(desc, 'Area') or "N/A"

    cat = (props.get('Created At') or props.get('created_at') or 
           props.get('CreatedAt') or props.get('Date') or 
           props.get('date'))
    if not cat or cat == "N/A": 
        cat = find_in_desc(desc, 'Created At') or find_in_desc(desc, 'Date') or find_in_desc(desc, 'created_at') or "N/A"

    fid = (props.get('id') or props.get('OBJECTID') or props.get('NAME') or 
           props.get('name') or (pid if pid != "N/A" else f"Feature_{index}"))
    
    return {
        "id": fid, "pid": pid, "pby": pby, "cat": cat, "pn": pn, "npc": npc, "area": area_val,
        "geom_area": float(properties.get('_geom_area', 0))
    }

def force_2d(geom):
    """ Strips Z-axis/altitude from geometry which causes zero-area intersections. """
    if geom is None or geom.is_empty: return geom
    if geom.has_z:
        return transform(lambda x, y, z=None: (x, y), geom)
    return geom

def calculate_feature_overlaps(file_path, output_csv=None):
    """
    Calculates overlapping pairs and their area.
    Returns a DataFrame and optionally saves to CSV.
    """
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} not found.")
        return None
    
    print(f"Reading {file_path}...")
    gdf = read_kmz(file_path)
    if gdf.empty:
        print("No features found.")
        return None

    # Step 1: Pre-filter out-of-bounds WGS84 coordinates
    def is_valid_wgs84(geom):
        if geom is None or geom.is_empty: return False
        b = geom.bounds
        return (b[0] >= -180 and b[2] <= 180 and b[1] >= -90 and b[3] <= 90)

    gdf = gdf[gdf.geometry.map(is_valid_wgs84)]
    
    # Step 2: Flatten to 2D and fix validity
    print("Fixing geometries and stripping Z-axis...")
    gdf['geometry'] = gdf.geometry.map(force_2d)
    gdf['geometry'] = gdf.geometry.make_valid()

    # Step 3: Project to local UTM (meters)
    if gdf.crs is None:
        gdf.set_crs("EPSG:4326", inplace=True)
    
    try:
        utm_crs = gdf.estimate_utm_crs()
        print(f"Projecting to estimated UTM: {utm_crs}")
        gdf_p = gdf.to_crs(utm_crs)
    except Exception:
        print("UTM Estimation failed, using EPSG:3857 fallback.")
        gdf_p = gdf.to_crs("EPSG:3857")

    gdf_p['geometry'] = gdf_p.geometry.make_valid()
    gdf_p = gdf_p[~gdf_p.geometry.is_empty & gdf_p.geometry.notnull()].reset_index(drop=True)

    # Step 4: Spatial Index Query
    sindex = gdf_p.sindex
    pairs = []
    involved_indices = set()
    n = len(gdf_p)
    print(f"Checking {n} features for overlaps...")
    
    for i in range(n):
        if i % 200 == 0: print(f"Processed {i}/{n}...")
        row_i = gdf_p.iloc[i]
        geom_i = row_i.geometry
        # Store geometric area in properties for extract_details
        row_i_dict = row_i.to_dict()
        row_i_dict['_geom_area'] = geom_i.area / 10000.0
        details_i = extract_details(row_i_dict, i)
        
        possible_indices = sindex.query(geom_i, predicate='intersects')
        
        for j in possible_indices:
            if j <= i: continue
            
            row_j = gdf_p.iloc[j]
            geom_j = row_j.geometry
            
            try:
                if geom_i.intersects(geom_j):
                    intersection = geom_i.intersection(geom_j)
                    # Keep small intersections but format them in sq meters if they are very tiny
                    if not intersection.is_empty and intersection.area > 0.0001:
                        area_sqm = float(intersection.area)
                        
                        if area_sqm < 100.0: # If less than 100 sq meters (0.01 hectares), show in sq meters
                            overlap_display = f"{area_sqm:.2f} sq meter"
                        else:
                            overlap_display = f"{(area_sqm / 10000):.6f}"
                            
                        # Store geometric area for details_j
                        row_j_dict = row_j.to_dict()
                        row_j_dict['_geom_area'] = row_j.geometry.area / 10000.0
                        details_j = extract_details(row_j_dict, j)
                        
                        involved_indices.add(i)
                        involved_indices.add(j)
                        pairs.append({
                            "Plantation ID": details_i['pid'],
                            "Plantation By (Department)": details_i['pby'],
                            "Plants Name": details_i['pn'],
                            "No. of Plants": details_i['npc'],
                            "Area (Text)": details_i['area'],
                            "Actual Area (hectares)": f"{details_i['geom_area']:.6f}",
                            "Created At": details_i['cat'],
                            "Overlapping Plantation ID": details_j['pid'],
                            "Overlapping Plantation By": details_j['pby'],
                            "Overlapping Feature Area (Text)": details_j['area'],
                            "Overlapping Feature Actual Area (Hec)": f"{details_j['geom_area']:.6f}",
                            "Overlapping Plantation": details_j['pn'],
                            "Overlapping No. of Plants": details_j['npc'],
                            "Overlapping Created At": details_j['cat'],
                            "Overlap Area (Hectares)": overlap_display
                        })
            except Exception:
                continue

    if not pairs:
        print("No overlaps found.")
        return pd.DataFrame(), 0

    df = pd.DataFrame(pairs)
    
    # Sorting: Department first (alphabetical), then Plantation ID
    # Use case-insensitive sort for strings where possible
    if not df.empty:
        sort_cols = ["Plantation By (Department)", "Plantation ID"]
        available_cols = [c for c in sort_cols if c in df.columns]
        if available_cols:
            df = df.sort_values(by=available_cols).reset_index(drop=True)

    if output_csv:
        export_df = df.copy()
        previous_pid = None
        cols_to_clear = ["Plantation ID", "Plantation By (Department)", "Plants Name", "No. of Plants", "Area (Text)", "Actual Area (hectares)", "Created At"]
        
        for idx in export_df.index:
            current_pid = export_df.at[idx, "Plantation ID"]
            if current_pid == previous_pid:
                for col in cols_to_clear:
                    if col in export_df.columns:
                        export_df.at[idx, col] = ""
            previous_pid = current_pid

        export_df.to_csv(output_csv, index=False, encoding='utf-8-sig')
        print(f"Saved {len(pairs)} overlaps to {output_csv}")
    
    return df, len(involved_indices)

if __name__ == "__main__":
    kmz_file = "C:/Users/pc/Downloads/plantation_data_2026-02-26T04-37-38-367Z.kmz"
    output_csv = "overlap_report.csv"
    df, count = calculate_feature_overlaps(kmz_file, output_csv)
    print(f"Found {len(df)} overlap pairs involving {count} unique features.")
