"""
tiling_io.py
------------
Low-level chunk file I/O helpers extracted from TilingService.
Keeps TilingService focused on orchestration logic only.
"""
import os
import copy
import json
import math
from shapely.geometry import shape


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def normalize_geometry(geometry):
    """
    Strip altitude (Z) from any GeoJSON geometry to produce a clean 2D dict.
    Prevents Shapely ValueError when coordinates are inhomogeneous (mix of 2D/3D).
    """
    def _strip_z(coords):
        if not coords:
            return coords
        if isinstance(coords[0], (int, float)):
            return list(coords[:2])
        return [_strip_z(c) for c in coords]

    geom = copy.deepcopy(geometry)
    if geom and 'coordinates' in geom:
        geom['coordinates'] = _strip_z(geom['coordinates'])
    return geom


def safe_shape(geometry):
    """
    Wraps shapely.shape() with geometry normalization and error handling.
    Returns None on failure instead of raising.
    """
    if not geometry:
        return None
    try:
        return shape(normalize_geometry(geometry))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Grid-cell helpers
# ---------------------------------------------------------------------------

def get_feature_cells(feature, grid_size):
    """
    Returns a list of (x, y) grid-cell indices that cover the feature's geometry.
    Returns [] if geometry is missing or invalid.
    """
    geom = safe_shape(feature.get('geometry'))
    if geom is None or geom.is_empty:
        return []
    b = geom.bounds  # (minx, miny, maxx, maxy)
    cells = []
    for x in range(math.floor(b[0] / grid_size), math.floor(b[2] / grid_size) + 1):
        for y in range(math.floor(b[1] / grid_size), math.floor(b[3] / grid_size) + 1):
            cells.append((x, y))
    return cells


def get_feature_id(feature):
    """Resolves a feature's canonical ID from common property locations."""
    return (feature.get('_id') or feature.get('id') or
            feature.get('properties', {}).get('_id') or
            feature.get('properties', {}).get('id'))


# ---------------------------------------------------------------------------
# Metadata helpers
# ---------------------------------------------------------------------------

def get_session_grid_size(session_id, default_grid_size):
    """Reads the grid size used for a session from its metadata file."""
    try:
        meta_path = os.path.join('media', 'chunks', session_id, 'metadata.json')
        if os.path.exists(meta_path):
            with open(meta_path, 'r') as mf:
                return json.load(mf).get('grid_size', default_grid_size)
    except Exception:
        pass
    return default_grid_size


# ---------------------------------------------------------------------------
# Chunk read helpers
# ---------------------------------------------------------------------------

def read_chunk(chunk_path):
    """Yields parsed feature dicts from a NDJSON chunk file."""
    try:
        with open(chunk_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except Exception:
        return


def read_chunk_lines(chunk_path):
    """Returns the raw NDJSON lines from a chunk file (for rewrite operations)."""
    lines = []
    if not os.path.exists(chunk_path):
        return lines
    try:
        with open(chunk_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    lines.append(line)
    except Exception:
        pass
    return lines


# ---------------------------------------------------------------------------
# Chunk write helper
# ---------------------------------------------------------------------------

def write_chunk(chunk_path, lines):
    """
    Writes lines to a chunk file (truncate-then-write).
    Using truncation avoids Windows PermissionError from os.remove() on locked files.
    """
    with open(chunk_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
