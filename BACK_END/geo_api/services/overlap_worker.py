import json
import os
import math
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely.ops import transform
from ..utils.geom_utils import calculate_area_ha

def process_chunk_worker(chunk_path, grid_size, extract_details_fn_name, format_plants_data_fn_name):
    """
    Worker function to process a single chunk file.
    Calculates overlaps within the chunk using STRtree for performance.
    
    Args:
        chunk_path: Path to the JSON chunk file.
        grid_size: Size of the grid used for tiling.
        extract_details_fn_name: (Not used directly here, but could be passed if needed)
    """
    # Extract x, y from chunk_path (chunk_x_y.json)
    filename = os.path.basename(chunk_path)
    parts = filename.replace('.json', '').split('_')
    if len(parts) < 3: return []
    try:
        chunk_x = int(parts[1])
        chunk_y = int(parts[2])
    except: return []

    features = []
    with open(chunk_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip(): continue
            try:
                feat = json.loads(line)
                if not feat.get('geometry'): continue
                geom = shape(feat['geometry'])
                if geom.is_empty: continue
                
                # Force 2D
                if geom.has_z:
                    geom = transform(lambda x, y, z=None: (x, y), geom)
                
                features.append({
                    'id': feat.get('_id') or feat.get('id'),
                    'geom': geom,
                    'properties': feat.get('properties', {})
                })
            except:
                continue

    if len(features) < 2:
        return []

    results = []
    geoms = [f['geom'] for f in features]
    tree = STRtree(geoms)
    
    # Use a set to avoid processing the same pair twice within one chunk
    processed_in_chunk = set()

    for i, f_i in enumerate(features):
        geom_i = f_i['geom']
        # query() returns indices of geometries whose BBox intersects geom_i's BBox
        potential_indices = tree.query(geom_i)
        
        for j_idx in potential_indices:
            if i == j_idx: continue
            
            pair_key = tuple(sorted((i, j_idx)))
            if pair_key in processed_in_chunk: continue
            processed_in_chunk.add(pair_key)
            
            f_j = features[j_idx]
            geom_j = f_j['geom']
            
            try:
                # Top-Left Cell Optimization: 
                # Only process the pair in the top-left-most cell of their intersection's BBox.
                # This ensures we only compute each pair once across all chunks.
                bbox_i = geom_i.bounds
                bbox_j = geom_j.bounds
                
                # Fast BBox intersection
                inter_min_x = max(bbox_i[0], bbox_j[0])
                inter_max_y = min(bbox_i[3], bbox_j[3]) # Coordinate Y increases upwards? 
                # Actually math.floor(y / grid_size) is used.
                # Let's use the min/min corner (bottom-left) for simplicity.
                inter_min_y = max(bbox_i[1], bbox_j[1])
                
                if (math.floor(inter_min_x / grid_size) != chunk_x or 
                    math.floor(inter_min_y / grid_size) != chunk_y):
                    continue

                if geom_i.intersects(geom_j):
                    intersection = geom_i.intersection(geom_j)
                    if not intersection.is_empty and (intersection.area > 0.00000001 or intersection.geom_type in ['Point', 'MultiPoint']):
                        area_ha = calculate_area_ha(intersection)
                        results.append({
                            'id1': f_i['id'],
                            'id2': f_j['id'],
                            'area_ha': area_ha,
                            'props1': f_i['properties'],
                            'props2': f_j['properties'],
                            'geom_area1': calculate_area_ha(f_i['geom']),
                            'geom_area2': calculate_area_ha(f_j['geom']),
                        })
            except:
                continue
                
    return results
