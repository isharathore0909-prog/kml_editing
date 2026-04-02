import os
import re
import math
import json
import fiona
import pandas as pd
import geopandas as gpd
from zipfile import ZipFile
from shapely.ops import transform
from shapely.geometry import shape
from shapely.strtree import STRtree
from concurrent.futures import ThreadPoolExecutor, as_completed
import pyproj
from shapely.ops import transform
from functools import partial
from .base_service import BaseService
from .tiling_service import TilingService
from .overlap_worker import process_chunk_worker

class OverlapService(BaseService):
    def __init__(self):
        super().__init__()
        # Ensure drivers are enabled
        self.ensure_drivers()

    def ensure_drivers(self):
        if 'KML' not in fiona.drvsupport.supported_drivers:
            fiona.drvsupport.supported_drivers['KML'] = 'rw'
        if 'LIBKML' not in fiona.drvsupport.supported_drivers:
            fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'

    def read_kmz(self, file_path):
        """ Reads KMZ or KML files using fiona. Handles zip URIs for KMZ. """
        try:
            layers = fiona.listlayers(file_path)
            gdfs = []
            for layer in layers:
                gdfs.append(gpd.read_file(file_path, layer=layer, engine='fiona'))
            if not gdfs:
                 return gpd.read_file(file_path, engine='fiona')
            return pd.concat(gdfs, ignore_index=True)
        except Exception as e:
            with ZipFile(file_path, 'r') as zh:
                kml_files = [f for f in zh.namelist() if f.lower().endswith('.kml')]
                if not kml_files:
                    raise ValueError("No KML file found inside KMZ.")
                
                all_gdfs = []
                abs_path = os.path.abspath(file_path).replace("\\", "/")
                for kml_f in kml_files:
                    zip_uri = f"zip://{abs_path}!{kml_f}"
                    try:
                        all_gdfs.append(gpd.read_file(zip_uri, engine='fiona'))
                    except:
                        continue
                if not all_gdfs:
                    return gpd.DataFrame()
                return pd.concat(all_gdfs, ignore_index=True)

    def find_in_desc(self, desc, keyword):
        """ Helper to extract values from KML description string using regex. """
        if not desc or not isinstance(desc, str):
            return None
        try:
            t_pattern = rf'(?:<th>|<td>)[^<]*{keyword}[^<]*(?:</th>|</td>)\s*(?:<th>|<td>)(.*?)(?:</th>|</td>)'
            t_match = re.search(t_pattern, desc, re.IGNORECASE | re.DOTALL)
            if t_match and t_match.group(1):
                return re.sub('<[^>]+>', '', t_match.group(1)).strip()

            k_pattern = rf'{keyword}\s*[:=]\s*(.*?)(?:\\n|\n|$)'
            k_match = re.search(k_pattern, desc, re.IGNORECASE)
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

    def format_plants_data(self, raw_val):
        """ Parses JSON-like plant data into a readable string. """
        if not raw_val or raw_val == "N/A":
            return "N/A", "N/A"
        
        try:
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

            data = None
            if isinstance(raw_val, str):
                clean_val = raw_val.strip()
                if clean_val.startswith("[{'") or clean_val.startswith("{'"):
                    clean_val = clean_val.replace("'", '"')
                
                if clean_val.startswith('[') or clean_val.startswith('{'):
                    try:
                        data = json.loads(clean_val)
                    except json.JSONDecodeError:
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

    def calculate_area_ha(self, geom):
        """Calculates area in hectares for a geometry (handling WGS84 vs Metric)."""
        if not geom or geom.is_empty: return 0.0
        
        try:
            # Check if coordinates are degrees (WGS84 approx -180 to 180)
            bounds = geom.bounds
            if abs(bounds[0]) <= 181 and abs(bounds[2]) <= 181 and abs(bounds[1]) <= 91 and abs(bounds[3]) <= 91:
                # Use pyproj Geod for accurate WGS84 area calculation
                geod = pyproj.Geod(ellps='WGS84')
                area_m2, _ = geod.geometry_area_perimeter(geom)
                return abs(area_m2) / 10000.0
            else:
                # Likely already in meters (UTM or Web Mercator)
                return geom.area / 10000.0
        except Exception:
            # Fallback to rough approximation if pyproj fails
            return geom.area * (111111**2) / 10000.0

    def extract_details(self, properties, index, geom=None):
        """ Helper to extract details from properties and calculate area from geom. """
        props = properties
        desc = props.get('description') or props.get('Description') or props.get('DESCRIPTION') or ""
        
        pid = (props.get('Plantation ID') or props.get('plantation_id') or 
               props.get('PlantationId') or props.get('plantation id'))
        if not pid or pid == "N/A": 
            pid = self.find_in_desc(desc, 'Plantation ID') or self.find_in_desc(desc, 'plantation_id') or "N/A"

        pby = (props.get('Plantation By') or props.get('plantation_by') or 
               props.get('Department') or props.get('department') or 
               props.get('Plantation by'))
        if not pby or pby == "N/A": 
            pby = self.find_in_desc(desc, 'Plantation By') or self.find_in_desc(desc, 'Department') or self.find_in_desc(desc, 'plantation_by') or "N/A"

        pn_raw = (props.get('Plants Name') or props.get('plants_name') or 
                  props.get('Plant Name') or props.get('plant_name') or
                  props.get('PlantsName') or props.get('PlantName'))
        if not pn_raw or pn_raw == "N/A":
            pn_raw = self.find_in_desc(desc, 'Plants Name') or self.find_in_desc(desc, 'Plant Name') or self.find_in_desc(desc, 'plants_name') or "N/A"

        pn, npc_calc = self.format_plants_data(pn_raw)

        npc = (props.get('No of Plants') or props.get('no_of_plants') or 
               props.get('No. of Plants') or props.get('Number of Plants') or
               props.get('count') or props.get('Count'))
        if not npc or npc == "N/A":
            npc = self.find_in_desc(desc, 'No of Plants') or self.find_in_desc(desc, 'No. of Plants') or self.find_in_desc(desc, 'Number of Plants') or npc_calc or "N/A"

        area_val = (props.get('Area') or props.get('area') or props.get('AREA'))
        if not area_val or area_val == "N/A":
            area_val = self.find_in_desc(desc, 'Area') or "N/A"

        cat = (props.get('Created At') or props.get('created_at') or 
               props.get('CreatedAt') or props.get('Date') or 
               props.get('date'))
        if not cat or cat == "N/A": 
            cat = self.find_in_desc(desc, 'Created At') or self.find_in_desc(desc, 'Date') or self.find_in_desc(desc, 'created_at') or "N/A"

        fid = (props.get('_id') or props.get('id') or props.get('OBJECTID') or props.get('NAME') or 
               props.get('name') or (pid if pid != "N/A" else f"Feature_{index}"))
        
        # Calculate area from geometry if provided, otherwise check props
        geom_area = 0.0
        if geom:
            geom_area = self.calculate_area_ha(geom)
        else:
            try:
                raw_area = props.get('_geom_area')
                if raw_area is not None:
                    geom_area = float(raw_area)
            except (ValueError, TypeError):
                pass
        
        # Final fallback to parsing text if still 0
        if geom_area <= 0 and area_val and area_val != "N/A":
            try:
                matches = re.findall(r'(\d+\.?\d*)', str(area_val))
                if matches: geom_area = float(matches[0])
            except: pass

        return {
            "_id": fid, "pid": pid, "pby": pby, "cat": cat, "pn": pn, "npc": npc, "area": area_val,
            "geom_area": geom_area
        }

    def force_2d(self, geom):
        if geom is None or geom.is_empty: return geom
        if geom.has_z:
            return transform(lambda x, y, z=None: (x, y), geom)
        return geom

    def get_total_bounds(self, file_path):
        """Calculates the total BBox of the dataset in Leaflet format: [[miny, minx], [maxy, maxx]]."""
        minx, miny, maxx, maxy = float('inf'), float('inf'), float('-inf'), float('-inf')
        found = False
        for f in self._stream_features(file_path):
            if not f.get('geometry'): continue
            try:
                geom = shape(f['geometry'])
                if geom.is_empty: continue
                l_minx, l_miny, l_maxx, l_maxy = geom.bounds
                minx = min(minx, l_minx)
                miny = min(miny, l_miny)
                maxx = max(maxx, l_maxx)
                maxy = max(maxy, l_maxy)
                found = True
            except: continue
        
        if not found: return None
        return [[miny, minx], [maxy, maxx]]

    def calculate_overlaps(self, file_path, session_id=None):
        """
        Memory-efficient overlap calculation.
        Automatically switches to tiled parallel processing if the session is already tiled.
        """
        if session_id:
            from .tiling_service import TilingService
            ts = TilingService()
            if ts.is_tiled(session_id):
                print(f"[*] Detected tiled session {session_id}. Using parallel tiled processor.")
                return self.calculate_overlaps_tiled(session_id)

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file_path} not found.")
        
        # Standard file: load into GeoPandas for "proper" projection-based calculation
        gdf = self.read_kmz(file_path)
        if gdf.empty:
            return pd.DataFrame(), 0

        # Pre-process: handle geometry validity and 2D conversion
        gdf['geometry'] = gdf.geometry.map(self.force_2d)
        gdf['geometry'] = gdf.geometry.make_valid()
        
        # Determine CRS and project to UTM for accurate area calculation
        if gdf.crs is None:
            gdf.set_crs("EPSG:4326", inplace=True)
            
        try:
            target_crs = gdf.estimate_utm_crs()
            gdf_m = gdf.to_crs(target_crs)
        except Exception:
            # Fallback to Web Mercator if UTM estimation fails
            gdf_m = gdf.to_crs("EPSG:3857")

        # Re-verify validity after projection
        gdf_m['geometry'] = gdf_m.geometry.make_valid()
        gdf_m = gdf_m[~gdf_m.geometry.is_empty & gdf_m.geometry.notnull()].reset_index(drop=True)

        features = []
        for i in range(len(gdf_m)):
            features.append({
                'geom': gdf_m.iloc[i].geometry,
                'details': self.extract_details(gdf_m.iloc[i].to_dict(), i, gdf_m.iloc[i].geometry)
            })

        pairs = []
        involved_indices = set()
        n = len(features)
        
        # Use spatial index (STRtree) for matching
        from shapely.strtree import STRtree
        tree = STRtree([f['geom'] for f in features])
        
        for i in range(n):
            f_i = features[i]
            geom_i = f_i['geom']
            det_i = f_i['details']
            
            # Query the spatial index
            possible_indices = tree.query(geom_i)
            
            for j in possible_indices:
                if j <= i: continue
                
                f_j = features[j]
                geom_j = f_j['geom']
                det_j = f_j['details']
                
                try:
                    if geom_i.intersects(geom_j):
                        intersection = geom_i.intersection(geom_j)
                        if not intersection.is_empty and (intersection.area > 0.0001 or intersection.geom_type in ['Point', 'MultiPoint']):
                            # Area is in meters squared, convert to hectares
                            area_ha = intersection.area / 10000.0
                            
                            overlap_display = f"{area_ha:.4f} Ha"
                            if area_ha < 0.01:
                                overlap_display = f"{area_ha * 10000:.2f} sq meter"
                            
                            involved_indices.add(i)
                            involved_indices.add(j)
                            pairs.append({
                                "Plantation ID": det_i['pid'],
                                "Plantation By (Department)": det_i['pby'],
                                "Plants Name": det_i['pn'],
                                "No. of Plants": det_i['npc'],
                                "Area (Text)": det_i['area'],
                                "Actual Area (hectares)": f"{det_i['geom_area']:.4f}",
                                "Created At": det_i['cat'],
                                "Overlapping Plantation ID": det_j['pid'],
                                "Overlapping Plantation By": det_j['pby'],
                                "Overlapping Plants Name": det_j['pn'],
                                "Overlapping No. of Plants": det_j['npc'],
                                "Overlapping Area (Text)": det_j['area'],
                                "Overlapping Actual Area (hectares)": f"{det_j['geom_area']:.4f}",
                                "Overlapping Created At": det_j['cat'],
                                "Overlap Area (Hectares)": overlap_display
                            })
                except Exception:
                    continue

        if not pairs:
            return pd.DataFrame(), 0

        df = pd.DataFrame(pairs)
        return df, len(involved_indices)

    def calculate_overlaps_tiled(self, session_id):
        """
        Calculates overlaps by processing grid chunks in parallel.
        """
        import glob
        chunk_dir = os.path.join('media', 'chunks', session_id)
        chunk_files = glob.glob(os.path.join(chunk_dir, "chunk_*.json"))
        
        if not chunk_files:
            return pd.DataFrame(), 0
            
        ts = TilingService()
        grid_size = ts._get_session_grid_size(session_id)
        
        all_results = []

        # NOTE: ThreadPoolExecutor is not used here because Django's dev server
        # auto-reloader causes "cannot schedule new futures after interpreter shutdown".
        # Synchronous processing is robust and still fast due to STRtree in each worker.
        print(f"[*] Processing {len(chunk_files)} chunks synchronously...")
        for cf in chunk_files:
            try:
                all_results.extend(process_chunk_worker(cf, grid_size, None, None))
            except Exception as e:
                print(f"[*] Chunk processing error for {cf}: {e}")

        if not all_results:
            return pd.DataFrame(), 0
            
        # Deduplicate and format results
        details_cache = {}
        processed_pairs = set()
        final_pairs = []
        involved_ids = set()
        
        for res in all_results:
            id1 = res['id1']
            id2 = res['id2']
            
            # Use string conversion to avoid TypeError if IDs are mixed types (int vs str)
            pair_key = tuple(sorted((str(id1), str(id2))))
            if pair_key in processed_pairs: continue
            processed_pairs.add(pair_key)
            
            # Caching extract_details to avoid redundant processing.
            # Inject _geom_area from worker results so extract_details can populate "Actual Area (hectares)".
            if id1 not in details_cache:
                props1 = dict(res['props1'])
                props1['_geom_area'] = res.get('geom_area1', 0)
                details_cache[id1] = self.extract_details(props1, 0)
            if id2 not in details_cache:
                props2 = dict(res['props2'])
                props2['_geom_area'] = res.get('geom_area2', 0)
                details_cache[id2] = self.extract_details(props2, 1)
                
            det1 = details_cache[id1]
            det2 = details_cache[id2]
            
            try:
                area_ha = res['area_ha']
                overlap_display = f"{area_ha:.4f} Ha"
                if area_ha < 0.01:
                    overlap_display = f"{area_ha*10000:.2f} sq meter"
                
                final_pairs.append({
                    "Plantation ID": str(det1.get('pid', 'N/A')),
                    "Plantation By (Department)": str(det1.get('pby', 'N/A')),
                    "Plants Name": str(det1.get('pn', 'N/A')),
                    "No. of Plants": str(det1.get('npc', 'N/A')),
                    "Area (Text)": str(det1.get('area', 'N/A')),
                    "Actual Area (hectares)": f"{float(det1.get('geom_area', 0)):.4f}",
                    "Created At": str(det1.get('cat', 'N/A')),
                    "Overlapping Plantation ID": str(det2.get('pid', 'N/A')),
                    "Overlapping Plantation By": str(det2.get('pby', 'N/A')),
                    "Overlapping Plants Name": str(det2.get('pn', 'N/A')),
                    "Overlapping No. of Plants": str(det2.get('npc', 'N/A')),
                    "Overlapping Area (Text)": str(det2.get('area', 'N/A')),
                    "Overlapping Actual Area (hectares)": f"{float(det2.get('geom_area', 0)):.4f}",
                    "Overlapping Created At": str(det2.get('cat', 'N/A')),
                    "Overlap Area (Hectares)": overlap_display
                })
                involved_ids.add(id1)
                involved_ids.add(id2)
            except Exception as e:
                print(f"[*] Error formatting result pair: {e}")
                continue

        return pd.DataFrame(final_pairs), len(involved_ids)

