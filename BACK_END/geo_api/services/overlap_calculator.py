"""
overlap_calculator.py
---------------------
Geometry analysis helpers for the overlap pipeline.
Extracted from overlap_service.py for single-responsibility.
"""
import pyproj
from shapely.ops import transform
from shapely.strtree import STRtree


def force_2d(geom):
    """Strip the Z coordinate from a Shapely geometry."""
    if geom is None or geom.is_empty:
        return geom
    if geom.has_z:
        return transform(lambda x, y, z=None: (x, y), geom)
    return geom


def calculate_area_ha(geom):
    """Calculates area in hectares for a WGS84 or metric geometry."""
    if not geom or geom.is_empty:
        return 0.0
    try:
        bounds = geom.bounds
        if (abs(bounds[0]) <= 181 and abs(bounds[2]) <= 181 and
                abs(bounds[1]) <= 91 and abs(bounds[3]) <= 91):
            geod = pyproj.Geod(ellps='WGS84')
            area_m2, _ = geod.geometry_area_perimeter(geom)
            return abs(area_m2) / 10_000.0
        else:
            return geom.area / 10_000.0
    except Exception:
        return geom.area * (111_111 ** 2) / 10_000.0


def format_overlap_display(area_ha):
    """Returns a human-readable overlap area string."""
    if area_ha < 0.01:
        return f"{area_ha * 10_000:.2f} sq meter"
    return f"{area_ha:.4f} Ha"


def build_overlap_row(det1, det2, area_ha):
    """Builds a single result dict for a confirmed overlap pair."""
    return {
        "Plantation ID":                     str(det1.get('pid', 'N/A')),
        "Plantation By (Department)":        str(det1.get('pby', 'N/A')),
        "Plants Name":                       str(det1.get('pn', 'N/A')),
        "No. of Plants":                     str(det1.get('npc', 'N/A')),
        "Area (Text)":                       str(det1.get('area', 'N/A')),
        "Actual Area (hectares)":            f"{float(det1.get('geom_area', 0)):.4f}",
        "Created At":                        str(det1.get('cat', 'N/A')),
        "Overlapping Plantation ID":         str(det2.get('pid', 'N/A')),
        "Overlapping Plantation By":         str(det2.get('pby', 'N/A')),
        "Overlapping Plants Name":           str(det2.get('pn', 'N/A')),
        "Overlapping No. of Plants":         str(det2.get('npc', 'N/A')),
        "Overlapping Area (Text)":           str(det2.get('area', 'N/A')),
        "Overlapping Actual Area (hectares)":f"{float(det2.get('geom_area', 0)):.4f}",
        "Overlapping Created At":            str(det2.get('cat', 'N/A')),
        "Overlap Area (Hectares)":           format_overlap_display(area_ha),
    }


def run_strtree_overlaps(features):
    """
    Finds all intersecting pairs in a list of {'geom': ..., 'details': ...} dicts
    using an STRtree spatial index.
    Returns a list of (det_i, det_j, area_ha) tuples.
    """
    results = []
    involved = set()
    n = len(features)
    if n < 2:
        return results, involved

    tree = STRtree([f['geom'] for f in features])

    for i in range(n):
        f_i    = features[i]
        geom_i = f_i['geom']
        det_i  = f_i['details']

        for j in tree.query(geom_i):
            if j <= i:
                continue
            geom_j = features[j]['geom']
            det_j  = features[j]['details']
            try:
                if geom_i.intersects(geom_j):
                    inter = geom_i.intersection(geom_j)
                    if not inter.is_empty and (
                        inter.area > 0.0001 or inter.geom_type in ('Point', 'MultiPoint')
                    ):
                        area_ha = inter.area / 10_000.0
                        involved.add(i)
                        involved.add(j)
                        results.append((det_i, det_j, area_ha))
            except Exception:
                continue

    return results, involved
