"""
overlap_service.py
------------------
Orchestrator for the overlap pipeline.
Delegates KML parsing to overlap_parser and geometry analytics to overlap_calculator.
"""
import os
import glob
import json
import pandas as pd
import geopandas as gpd

from .base_service import BaseService
from .tiling_service import TilingService
from .overlap_worker import process_chunk_worker
from .overlap_parser import read_kmz, extract_details
from .overlap_calculator import (
    force_2d, calculate_area_ha, build_overlap_row, run_strtree_overlaps
)


class OverlapService(BaseService):
    def __init__(self):
        super().__init__()
        self.ensure_drivers()

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def get_total_bounds(self, file_path):
        """Returns [[miny, minx], [maxy, maxx]] for the full dataset."""
        minx = miny = float('inf')
        maxx = maxy = float('-inf')
        found = False
        for f in self._stream_features(file_path):
            if not f.get('geometry'):
                continue
            try:
                from shapely.geometry import shape
                geom = shape(f['geometry'])
                if geom.is_empty:
                    continue
                b = geom.bounds
                minx, miny = min(minx, b[0]), min(miny, b[1])
                maxx, maxy = max(maxx, b[2]), max(maxy, b[3])
                found = True
            except Exception:
                continue
        return [[miny, minx], [maxy, maxx]] if found else None

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def calculate_overlaps(self, file_path, session_id=None):
        """
        Memory-efficient overlap calculation.
        Delegates to tiled path if the session is already tiled, otherwise
        loads into GeoPandas and runs in-memory STRtree analysis.
        """
        if session_id:
            ts = TilingService()
            if ts.is_tiled(session_id):
                print(f"[*] Tiled session detected. Using parallel tiled processor.")
                return self.calculate_overlaps_tiled(session_id)

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        gdf = read_kmz(file_path)
        if gdf.empty:
            return pd.DataFrame(), 0

        # Pre-process: 2D + validity
        gdf['geometry'] = gdf.geometry.map(force_2d).make_valid()
        if gdf.crs is None:
            gdf.set_crs("EPSG:4326", inplace=True)
        try:
            gdf_m = gdf.to_crs(gdf.estimate_utm_crs())
        except Exception:
            gdf_m = gdf.to_crs("EPSG:3857")

        gdf_m['geometry'] = gdf_m.geometry.make_valid()
        gdf_m = gdf_m[~gdf_m.geometry.is_empty & gdf_m.geometry.notnull()].reset_index(drop=True)

        features = [
            {
                'geom': gdf_m.iloc[i].geometry,
                'details': extract_details(
                    gdf_m.iloc[i].to_dict(), i,
                    geom=gdf_m.iloc[i].geometry,
                    calculate_area_ha_fn=calculate_area_ha
                )
            }
            for i in range(len(gdf_m))
        ]

        pairs, involved = run_strtree_overlaps(features)
        if not pairs:
            return pd.DataFrame(), 0

        rows = [build_overlap_row(det_i, det_j, area_ha) for det_i, det_j, area_ha in pairs]
        return pd.DataFrame(rows), len(involved)

    # ------------------------------------------------------------------
    # Tiled path
    # ------------------------------------------------------------------

    def calculate_overlaps_tiled(self, session_id):
        """Processes overlap calculation chunk-by-chunk for tiled sessions."""
        chunk_dir   = os.path.join('media', 'chunks', session_id)
        chunk_files = glob.glob(os.path.join(chunk_dir, "chunk_*.json"))
        if not chunk_files:
            return pd.DataFrame(), 0

        ts         = TilingService()
        grid_size  = ts._get_session_grid_size(session_id)
        all_results = []

        print(f"[*] Processing {len(chunk_files)} chunks synchronously...")
        for cf in chunk_files:
            try:
                all_results.extend(process_chunk_worker(cf, grid_size, None, None))
            except Exception as e:
                print(f"[*] Chunk error ({cf}): {e}")

        if not all_results:
            return pd.DataFrame(), 0

        details_cache   = {}
        processed_pairs = set()
        final_rows      = []
        involved_ids    = set()

        for res in all_results:
            id1, id2 = res['id1'], res['id2']
            pair_key = tuple(sorted((str(id1), str(id2))))
            if pair_key in processed_pairs:
                continue
            processed_pairs.add(pair_key)

            if id1 not in details_cache:
                p = dict(res['props1']); p['_geom_area'] = res.get('geom_area1', 0)
                details_cache[id1] = extract_details(p, 0)
            if id2 not in details_cache:
                p = dict(res['props2']); p['_geom_area'] = res.get('geom_area2', 0)
                details_cache[id2] = extract_details(p, 1)

            try:
                final_rows.append(build_overlap_row(
                    details_cache[id1], details_cache[id2], res['area_ha']
                ))
                involved_ids.add(id1)
                involved_ids.add(id2)
            except Exception as e:
                print(f"[*] Formatting error: {e}")
                continue

        return pd.DataFrame(final_rows), len(involved_ids)
    # ------------------------------------------------------------------
    # Caching
    # ------------------------------------------------------------------

    def get_cached_overlaps(self, session_id):
        """Loads cached overlaps from overlaps.json in the session directory."""
        if not session_id: return None
        cache_path = os.path.join('media', 'chunks', session_id, 'overlaps.json')
        if os.path.exists(cache_path):
            try:
                with open(cache_path, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def save_overlap_results(self, session_id, overlap_data):
        """Saves overlap results to overlaps.json in the session directory."""
        if not session_id: return
        parent_dir = os.path.join('media', 'chunks', session_id)
        if not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)
        
        cache_path = os.path.join(parent_dir, 'overlaps.json')
        try:
            with open(cache_path, 'w') as f:
                json.dump(overlap_data, f)
        except Exception:
            pass

    def invalidate_cache(self, session_id):
        """Deletes the overlaps.json cache file for the session."""
        if not session_id: return
        cache_path = os.path.join('media', 'chunks', session_id, 'overlaps.json')
        if os.path.exists(cache_path):
            try:
                os.remove(cache_path)
                print(f"[*] Invalidated overlap cache for session: {session_id}")
            except Exception as e:
                print(f"[*] Error invalidating cache: {e}")
