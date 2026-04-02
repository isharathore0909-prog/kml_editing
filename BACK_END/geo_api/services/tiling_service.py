"""
tiling_service.py
-----------------
Orchestrator for disk-based geographic tiling.
Low-level I/O is handled by tiling_io.py.
"""
import os
import json
import math
import shutil
import time
from django.conf import settings

from .base_service import BaseService
from .tiling_io import (
    normalize_geometry, safe_shape,
    get_feature_cells, get_feature_id,
    get_session_grid_size,
    read_chunk_lines, write_chunk,
)


class TilingService(BaseService):
    """
    Partitions large KMZ/GeoJSON files into a geographic grid stored on disk.
    Chunks are NDJSON files named chunk_<x>_<y>.json.
    """

    LARGE_FILE_THRESHOLD = 30 * 1024 * 1024  # 30 MB
    GRID_SIZE = 0.1
    MAX_FEATURES_PER_BBOX = 5000

    def __init__(self):
        super().__init__()
        self.ensure_drivers()

    # ------------------------------------------------------------------
    # Session helpers
    # ------------------------------------------------------------------

    def _chunk_dir(self, session_id):
        return os.path.join('media', 'chunks', session_id)

    def is_tiled(self, session_id):
        """Returns True if the session has a completed tiling metadata file."""
        return os.path.exists(os.path.join(self._chunk_dir(session_id), 'metadata.json'))

    def _get_session_grid_size(self, session_id):
        return get_session_grid_size(session_id, self.GRID_SIZE)

    def _cleanup_old_sessions(self):
        """
        Deletes session chunk directories older than CHUNK_STORAGE_RETENTION_DAYS.
        Safeguard: Always keeps 'default' session if it exists.
        """
        try:
            days = getattr(settings, 'CHUNK_STORAGE_RETENTION_DAYS', 1)
            seconds_threshold = days * 24 * 3600
            now = time.time()
            
            chunks_root = os.path.join('media', 'chunks')
            if not os.path.exists(chunks_root):
                return
                
            for session_id in os.listdir(chunks_root):
                if session_id == 'default':
                    continue
                    
                session_dir = os.path.join(chunks_root, session_id)
                if not os.path.isdir(session_dir):
                    continue
                    
                # Use mtime of the directory itself or metadata.json
                mtime = os.path.getmtime(session_dir)
                meta_path = os.path.join(session_dir, 'metadata.json')
                if os.path.exists(meta_path):
                    mtime = os.path.getmtime(meta_path)
                
                if (now - mtime) > seconds_threshold:
                    print(f"[CLEANUP] Deleting expired session chunks: {session_id} (age: {int((now-mtime)/3600)}h)")
                    shutil.rmtree(session_dir, ignore_errors=True)
                    
        except Exception as e:
            print(f"[CLEANUP] Error during automatic cleanup: {e}")

    # ------------------------------------------------------------------
    # Tiling
    # ------------------------------------------------------------------

    def process_large_file(self, file_path, session_id):
        """
        Streams file features and writes them into grid chunk files.
        Returns the chunk directory path, or None for small files.
        """
        if os.path.getsize(file_path) < self.LARGE_FILE_THRESHOLD:
            return None

        # Automatic cleanup of OTHER old sessions before processing new one
        self._cleanup_old_sessions()

        output_dir = self._chunk_dir(session_id)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)

        try:
            buffers = {}
            feature_count = 0
            for feature in self._stream_features(file_path):
                if not feature.get('geometry'):
                    continue
                geom = safe_shape(feature['geometry'])
                if geom is None or geom.is_empty:
                    continue

                # Ensure feature has an _id
                if '_id' not in feature and 'id' not in feature and 'properties' in feature:
                    feature['_id'] = (feature['properties'].get('_id') or
                                      feature['properties'].get('id') or
                                      f"f_{feature_count}")
                elif 'id' in feature and '_id' not in feature:
                    feature['_id'] = feature['id']

                feature_count += 1
                feat_json = json.dumps(feature) + "\n"
                b = geom.bounds

                for x in range(math.floor(b[0] / self.GRID_SIZE), math.floor(b[2] / self.GRID_SIZE) + 1):
                    for y in range(math.floor(b[1] / self.GRID_SIZE), math.floor(b[3] / self.GRID_SIZE) + 1):
                        cell = (x, y)
                        buffers.setdefault(cell, []).append(feat_json)
                        if len(buffers[cell]) >= 500:
                            chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
                            with open(chunk_path, 'a', encoding='utf-8') as f:
                                f.writelines(buffers[cell])
                            buffers[cell] = []

            # Final flush
            for (x, y), lines in buffers.items():
                if lines:
                    with open(os.path.join(output_dir, f"chunk_{x}_{y}.json"), 'a', encoding='utf-8') as f:
                        f.writelines(lines)

            with open(os.path.join(output_dir, 'metadata.json'), 'w') as mf:
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

    # ------------------------------------------------------------------
    # BBox query
    # ------------------------------------------------------------------

    def get_features_in_bbox(self, session_id, bbox):
        """Returns unique features within a bounding box [minx, miny, maxx, maxy]."""
        output_dir = self._chunk_dir(session_id)
        if not os.path.exists(output_dir):
            return None

        grid_size = self._get_session_grid_size(session_id)
        min_x = math.floor(bbox[0] / grid_size)
        max_x = math.floor(bbox[2] / grid_size)
        min_y = math.floor(bbox[1] / grid_size)
        max_y = math.floor(bbox[3] / grid_size)

        if (max_x - min_x + 1) * (max_y - min_y + 1) > 1000:
            return {"features": [], "limited": True, "count": 0}

        all_features = []
        seen_ids = set()

        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
                if not os.path.exists(chunk_path):
                    continue
                try:
                    with open(chunk_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            if not line.strip():
                                continue
                            try:
                                feature = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            f_id = get_feature_id(feature)
                            if f_id not in seen_ids:
                                all_features.append(feature)
                                seen_ids.add(f_id)
                                if len(all_features) >= self.MAX_FEATURES_PER_BBOX:
                                    return {"features": all_features, "limited": True, "count": len(all_features)}
                except Exception:
                    continue

        return {"features": all_features, "limited": False, "count": len(all_features)}

    # ------------------------------------------------------------------
    # Chunk mutation
    # ------------------------------------------------------------------

    def update_feature_in_chunks(self, session_id, old_feature, new_feature):
        """Replaces old_feature with new_feature in all affected chunk files."""
        output_dir = self._chunk_dir(session_id)
        if not os.path.exists(output_dir):
            return False

        grid_size = self._get_session_grid_size(session_id)

        # 1. Remove from all old cells first (if old_feature provided)
        if old_feature:
            f_id = get_feature_id(old_feature)
            if f_id:
                old_cells = get_feature_cells(old_feature, grid_size)
                for x, y in old_cells:
                    self.delete_feature_from_chunk(session_id, f_id, x, y)

        # 2. Add/Update in all new cells
        f_id = get_feature_id(new_feature)
        if not f_id:
            return False
            
        new_cells = get_feature_cells(new_feature, grid_size)
        for x, y in new_cells:
            chunk_path = os.path.join(output_dir, f"chunk_{x}_{y}.json")
            lines  = read_chunk_lines(chunk_path)
            found  = False
            new_lines = []
            for line in lines:
                try:
                    feat = json.loads(line)
                    if str(get_feature_id(feat)) == str(f_id):
                        new_lines.append(json.dumps(new_feature) + "\n")
                        found = True
                        continue
                except Exception:
                    pass
                new_lines.append(line)
            if not found:
                new_lines.append(json.dumps(new_feature) + "\n")
            write_chunk(chunk_path, new_lines)

        return True

    def delete_feature_from_chunks(self, session_id, feature):
        """Removes a feature from all chunk files it lives in."""
        output_dir = self._chunk_dir(session_id)
        if not os.path.exists(output_dir):
            return False
        f_id = get_feature_id(feature)
        if not f_id:
            return False
        grid_size = self._get_session_grid_size(session_id)
        for x, y in get_feature_cells(feature, grid_size):
            self.delete_feature_from_chunk(session_id, f_id, x, y)
        return True

    def delete_feature_from_chunk(self, session_id, feature_id, x, y):
        """Removes a single feature ID from the specified chunk file."""
        chunk_path = os.path.join(self._chunk_dir(session_id), f"chunk_{x}_{y}.json")
        if not os.path.exists(chunk_path):
            return False

        lines   = read_chunk_lines(chunk_path)
        changed = False
        kept    = []
        for line in lines:
            try:
                feat = json.loads(line)
                if str(get_feature_id(feat)) == str(feature_id):
                    changed = True
                    continue
            except Exception:
                pass
            kept.append(line)

        if changed:
            write_chunk(chunk_path, kept)  # truncate-write avoids Windows PermissionError
        return changed
