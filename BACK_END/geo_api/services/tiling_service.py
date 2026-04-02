import os
import json
import math
import fiona
import shutil
from fiona import Env
from shapely.geometry import shape, mapping
from zipfile import ZipFile
from .base_service import BaseService

class TilingService(BaseService):
    """
    Handles large KMZ/GeoJSON files by partitioning them into a geographic grid (Disk-based Tiling).
    Chunks are stored on disk for memory-efficient access via Bounding Box (BBox) queries.
    """
    
    LARGE_FILE_THRESHOLD = 30 * 1024 * 1024  # 30 MB
    GRID_SIZE = 0.1  # Default grid size
    MAX_FEATURES_PER_BBOX = 5000  # Increased from 3000
    
    def __init__(self):
        super().__init__()
        self.ensure_drivers()

    def process_large_file(self, file_path, session_id):
        """
        Streams a large file and saves features into grid-based disk-chunks.
        Returns the directory path if tiled, or None if the file is small enough for standard processing.
        """
        file_size = os.path.getsize(file_path)
        if file_size < self.LARGE_FILE_THRESHOLD:
            return None  # Small files don't need tiling

        output_dir = os.path.join('media', 'chunks', session_id)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)
        
        try:
            # Use a dictionary to buffer features before writing to disk
            buffers = {}
            feature_count = 0  # Must be initialized before the loop
            for feature in self._stream_features(file_path):
                if not feature.get('geometry'): continue
                
                geom = shape(feature['geometry'])
                if geom.is_empty: continue
                
                bounds = geom.bounds
                min_x_idx = math.floor(bounds[0] / self.GRID_SIZE)
                max_x_idx = math.floor(bounds[2] / self.GRID_SIZE)
                min_y_idx = math.floor(bounds[1] / self.GRID_SIZE)
                max_y_idx = math.floor(bounds[3] / self.GRID_SIZE)
                
                if '_id' not in feature and 'id' not in feature and 'properties' in feature:
                     feature['_id'] = feature['properties'].get('_id') or feature['properties'].get('id') or f"f_{feature_count}"
                elif 'id' in feature and '_id' not in feature:
                     feature['_id'] = feature['id']
                
                feature_count += 1
                feat_json = json.dumps(feature) + "\n"
                
                for x in range(min_x_idx, max_x_idx + 1):
                    for y in range(min_y_idx, max_y_idx + 1):
                        cell_key = (x, y)
                        if cell_key not in buffers:
                            buffers[cell_key] = []
                        buffers[cell_key].append(feat_json)
                        
                        # Flush large buffers to disk periodically
                        if len(buffers[cell_key]) >= 500:
                            chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
                            with open(chunk_path, 'a', encoding='utf-8') as f:
                                f.writelines(buffers[cell_key])
                            buffers[cell_key] = []

            # Final flush of all remaining buffers
            for (x, y), lines in buffers.items():
                if lines:
                    chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
                    with open(chunk_path, 'a', encoding='utf-8') as f:
                        f.writelines(lines)
                                    
            # Create a metadata file to confirm tiling is complete
            with open(os.path.join(output_dir, "metadata.json"), 'w') as mf:
                json.dump({
                    "session_id": session_id,
                    "grid_size": self.GRID_SIZE,
                    "total_features": feature_count,
                    "status": "completed"
                }, mf)
                
            return output_dir
        except Exception as e:
            if os.path.exists(output_dir):
                shutil.rmtree(output_dir)
            raise e

    def get_features_in_bbox(self, session_id, bbox):
        """
        bbox: [minx, miny, maxx, maxy]
        Returns a list of unique features found in the chunks overlapping the bbox.
        """
        output_dir = os.path.join('media', 'chunks', session_id)
        if not os.path.exists(output_dir):
            return None # Not tiled

        # Load grid size from metadata if available
        grid_size = self._get_session_grid_size(session_id)

        min_x_idx = math.floor(bbox[0] / grid_size)
        max_x_idx = math.floor(bbox[2] / grid_size)
        min_y_idx = math.floor(bbox[1] / grid_size)
        max_y_idx = math.floor(bbox[3] / grid_size)

        all_features = []
        seen_ids = set()

        # Safety: avoid opening too many files if zoom level is too low
        cells_count = (max_x_idx - min_x_idx + 1) * (max_y_idx - min_y_idx + 1)
        if cells_count > 1000:
            return {"features": [], "limited": True, "count": 0}

        for x in range(min_x_idx, max_x_idx + 1):
            for y in range(min_y_idx, max_y_idx + 1):
                chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
                if os.path.exists(chunk_path):
                    try:
                        with open(chunk_path, 'r', encoding='utf-8') as f:
                            for line in f:
                                if not line.strip(): continue
                                feature = json.loads(line)
                                # Deduplicate features that cross chunk boundaries
                                f_id = feature.get('_id') or feature.get('id') or feature.get('properties', {}).get('_id') or feature.get('properties', {}).get('id')
                                if f_id not in seen_ids:
                                    all_features.append(feature)
                                    seen_ids.add(f_id)
                                    
                                    # Hard limit to prevent browser from freezing
                                    if len(all_features) >= self.MAX_FEATURES_PER_BBOX:
                                        return {"features": all_features, "limited": True, "count": len(all_features)}
                    except Exception:
                        continue
                                
        return {"features": all_features, "limited": False, "count": len(all_features)}

    def _get_session_grid_size(self, session_id):
        """Recovers the grid size used for a specific session."""
        try:
            meta_path = os.path.join('media', 'chunks', session_id, "metadata.json")
            if os.path.exists(meta_path):
                with open(meta_path, 'r') as mf:
                    meta = json.load(mf)
                    return meta.get('grid_size', self.GRID_SIZE)
        except: pass
        return self.GRID_SIZE

    def is_tiled(self, session_id):
        """Checks if a session has been tiled."""
        meta_path = os.path.join('media', 'chunks', session_id, "metadata.json")
        return os.path.exists(meta_path)

    def _get_feature_cells(self, feature, grid_size=None):
        """Helper to find grid cell indices for a feature's geometry."""
        if not grid_size: grid_size = self.GRID_SIZE
        geom = shape(feature['geometry'])
        if geom.is_empty: return []
        bounds = geom.bounds  # (minx, miny, maxx, maxy)
        min_x = math.floor(bounds[0] / grid_size)
        max_x = math.floor(bounds[2] / grid_size)
        min_y = math.floor(bounds[1] / grid_size)
        max_y = math.floor(bounds[3] / grid_size)
        cells = []
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                cells.append((x, y))
        return cells

    def update_feature_in_chunks(self, session_id, old_feature, new_feature):
        """
        Updates a feature in the disk chunks. 
        Handles re-partitioning if the geometry has changed and spans different cells.
        """
        output_dir = os.path.join('media', 'chunks', session_id)
        if not os.path.exists(output_dir): return False

        f_id = old_feature.get('_id') or old_feature.get('id') or old_feature.get('properties', {}).get('_id') or old_feature.get('properties', {}).get('id')
        if not f_id: return False

        grid_size = self._get_session_grid_size(session_id)
        old_cells = self._get_feature_cells(old_feature, grid_size)
        new_cells = self._get_feature_cells(new_feature, grid_size)

        # 1. Remove from old cells that are not in new cells
        for x, y in old_cells:
            self.delete_feature_from_chunk(session_id, f_id, x, y)

        # 2. Update or add to new cells
        for x, y in new_cells:
            chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
            lines = []
            found = False
            if os.path.exists(chunk_path):
                with open(chunk_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        if not line.strip(): continue
                        feat = json.loads(line)
                        curr_id = feat.get('_id') or feat.get('id') or feat.get('properties', {}).get('_id') or feat.get('properties', {}).get('id')
                        if str(curr_id) == str(f_id):
                            lines.append(json.dumps(new_feature) + "\n")
                            found = True
                        else:
                            lines.append(line)
            
            if not found:
                lines.append(json.dumps(new_feature) + "\n")

            with open(chunk_path, 'w', encoding='utf-8') as f:
                f.writelines(lines)
        
        return True

    def delete_feature_from_chunks(self, session_id, feature):
        """Removes a feature from all its mapped disk chunks."""
        output_dir = os.path.join('media', 'chunks', session_id)
        if not os.path.exists(output_dir): return False

        f_id = feature.get('_id') or feature.get('id') or feature.get('properties', {}).get('_id') or feature.get('properties', {}).get('id')
        if not f_id: return False

        grid_size = self._get_session_grid_size(session_id)
        cells = self._get_feature_cells(feature, grid_size)
        for x, y in cells:
            self.delete_feature_from_chunk(session_id, f_id, x, y)
        return True

    def delete_feature_from_chunk(self, session_id, feature_id, x, y):
        """Helper to remove a feature from a specific chunk file."""
        chunk_path = os.path.join('media', 'chunks', session_id, f"chunk_{x}_{y}.json")
        if not os.path.exists(chunk_path): return False

        lines = []
        changed = False
        with open(chunk_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip(): continue
                feat = json.loads(line)
                curr_id = feat.get('_id') or feat.get('id') or feat.get('properties', {}).get('_id') or feat.get('properties', {}).get('id')
                if str(curr_id) == str(feature_id):
                    changed = True
                    continue
                lines.append(line)
        
        if changed:
            if not lines:
                os.remove(chunk_path)
            else:
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    f.writelines(lines)
        return changed
