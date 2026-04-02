from shapely.geometry import shape, mapping
import pyproj

def calculate_area_ha(geom):
    """
    Calculates area in hectares for a geometry using the most accurate method available.
    Uses ellipsoidal WGS84 area for geographic coordinates.
    """
    if not geom or geom.is_empty: return 0.0
    
    try:
        # Check if coordinates are degrees (WGS84 approx -180 to 180)
        bounds = geom.bounds
        if abs(bounds[0]) <= 181 and abs(bounds[2]) <= 181 and abs(bounds[1]) <= 91 and abs(bounds[3]) <= 91:
            # Use pyproj Geod for accurate WGS84 area calculation (ellipsoidal)
            geod = pyproj.Geod(ellps='WGS84')
            area_m2, _ = geod.geometry_area_perimeter(geom)
            return abs(area_m2) / 10000.0
        else:
            # Likely already in meters (UTM or Web Mercator)
            return geom.area / 10000.0
    except Exception:
        # Fallback to rough approximation if pyproj fails
        return geom.area * (111111**2) / 10000.0

def update_feature_geometry(feature, vertex_path, new_lng, new_lat):
    """
    Updates a specific vertex in a GeoJSON-like feature dictionary.
    """
    try:
        geom = feature.get('geometry', {})
        g_type = geom.get('type')
        coords = geom.get('coordinates', [])

        p_idx = vertex_path.get('part_index', 0)
        r_idx = vertex_path.get('ring_index', 0)
        v_idx = vertex_path.get('vertex_index', 0)

        def apply_update(g, p):
            g_type = g.get('type')
            c = g.get('coordinates', [])
            
            if g_type == 'Point':
                old_c = g.get('coordinates', [])
                new_c = [float(new_lng), float(new_lat)]
                if len(old_c) > 2: new_c.append(old_c[2])
                g['coordinates'] = new_c
            elif g_type == 'LineString':
                v_idx = p.get('vertex_index', 0)
                if v_idx < len(c):
                    old_c = c[v_idx]
                    new_c = [float(new_lng), float(new_lat)]
                    if len(old_c) > 2: new_c.append(old_c[2])
                    c[v_idx] = new_c
            elif g_type == 'Polygon':
                v_idx = p.get('vertex_index', 0)
                r_idx = p.get('ring_index', 0)
                if r_idx < len(c):
                    ring = c[r_idx]
                    if v_idx < len(ring):
                        old_c = ring[v_idx]
                        new_c = [float(new_lng), float(new_lat)]
                        if len(old_c) > 2: new_c.append(old_c[2])
                        ring[v_idx] = new_c
                        if v_idx == 0: ring[-1] = new_c
                        if v_idx == len(ring) - 1: ring[0] = new_c
            elif g_type == 'MultiLineString':
                p_idx = p.get('part_index', 0)
                v_idx = p.get('vertex_index', 0)
                if p_idx < len(c):
                    line = c[p_idx]
                    if v_idx < len(line):
                        old_c = line[v_idx]
                        new_c = [float(new_lng), float(new_lat)]
                        if len(old_c) > 2: new_c.append(old_c[2])
                        line[v_idx] = new_c
            elif g_type == 'MultiPolygon':
                p_idx = p.get('part_index', 0)
                r_idx = p.get('ring_index', 0)
                v_idx = p.get('vertex_index', 0)
                if p_idx < len(c):
                    poly = c[p_idx]
                    if r_idx < len(poly):
                        ring = poly[r_idx]
                        if v_idx < len(ring):
                            old_c = ring[v_idx]
                            new_c = [float(new_lng), float(new_lat)]
                            if len(old_c) > 2: new_c.append(old_c[2])
                            ring[v_idx] = new_c
                            if v_idx == 0: ring[-1] = new_c
                            if v_idx == len(ring) - 1: ring[0] = new_c
            elif g_type == 'GeometryCollection':
                geoms = g.get('geometries', [])
                p_idx = p.get('part_index', 0)
                if p_idx < len(geoms):
                    apply_update(geoms[p_idx], p)

        apply_update(geom, vertex_path)
        
        feature['geometry'] = geom
        return feature
    except Exception as e:
        print(f"Geometry update failed: {e}")
        return feature
