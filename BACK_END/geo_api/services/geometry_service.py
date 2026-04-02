import json
from .base_service import BaseService
from ..utils.geom_utils import update_feature_geometry

class GeometryService(BaseService):
    def _make_valid(self, geom):
        """Robustly repairs invalid geometry across different Shapely versions."""
        if not geom or geom.is_valid:
            return geom
        try:
            from shapely.validation import make_valid
            return make_valid(geom)
        except ImportError:
            # Fallback for older Shapely
            return geom.buffer(0)
    
    def update_vertex(self, feature, vertex_path, new_lng, new_lat):
        """Updates a vertex in a GeoJSON feature WITHOUT mutating the original."""
        try:
            import copy
            feature_copy = copy.deepcopy(feature)
            return update_feature_geometry(feature_copy, vertex_path, new_lng, new_lat)
        except Exception as e:
            raise Exception(f"Geometry update failed: {str(e)}")
    def merge_features(self, features):
        """Merges multiple GeoJSON features into one with property aggregation."""
        if not features or len(features) < 2:
            return None
            
        try:
            from shapely.ops import unary_union
            from shapely.geometry import shape, mapping
            import re
            
            geoms = []
            all_props = []
            for f in features:
                if not f or not isinstance(f, dict): continue
                geom_dict = f.get('geometry')
                if not geom_dict: continue
                try:
                    s = shape(geom_dict)
                    if not s.is_valid: s = s.buffer(0)
                    geoms.append(s)
                    all_props.append(f.get('properties', {}))
                except Exception as e:
                    print(f"Skipping invalid geometry in merge: {e}")
            
            if not geoms: return None
            
            # --- Robust Union Pipeline ---
            # 1. Snap to grid / Round coordinates to remove infinitesimal gaps
            def snap_geom(g):
                if g.is_empty: return g
                from shapely.wkt import loads, dumps
                # Rounding to 7 decimal places (~1cm) helps Shapely find shared edges
                return loads(dumps(g, rounding_precision=7))

            geoms = [self._make_valid(snap_geom(g)) for g in geoms]
            
            # 2. Direct union
            merged_geom = unary_union(geoms)
            
            # 3. Aggressive "Healing" (Dilation-Erosion)
            # We use a larger buffer and Mitre joins to bridge gaps without rounding corners too much.
            # 1e-4 is approx 10 meters at the equator.
            healing_dist = 1.5e-4 
            merged_geom = merged_geom.buffer(healing_dist, join_style=2).buffer(-healing_dist, join_style=2)
            
            # 4. Final Cleanup
            merged_geom = self._make_valid(merged_geom).simplify(1e-7)
            
            if merged_geom.is_empty: return None
            
            # --- Aggressive Property Merging ---
            # 1. Start with first feature's properties as base
            new_props = all_props[0].copy()
            
            # 2. Define fields to AGGREGATE
            SUM_FIELDS = ['No of Plants', 'no_of_plants', 'No. of Plants', 'Number of Plants', 'count', 'Count', 'npc']
            JOIN_FIELDS = ['Plantation ID', 'plantation_id', 'Plants Name', 'plants_name', 'Plant Name', 'plant_name']
            
            # 3. Aggregate from all features (starting from second)
            aggregated = {
                'total_plants': 0,
                'joined_ids': [str(new_props.get(f) or '') for f in JOIN_FIELDS if new_props.get(f)],
                'joined_names': [str(new_props.get(f) or '') for f in JOIN_FIELDS if new_props.get(f)]
            }
            
            # Try to get initial count from first
            for f in SUM_FIELDS:
                val = new_props.get(f)
                if val:
                    try:
                        # Extract number if it's a string like "100 plants"
                        nums = re.findall(r'\d+', str(val))
                        if nums: aggregated['total_plants'] += int(nums[0])
                    except: pass

            for next_props in all_props[1:]:
                # Summing
                for f in SUM_FIELDS:
                    val = next_props.get(f)
                    if val:
                        try:
                            nums = re.findall(r'\d+', str(val))
                            if nums: aggregated['total_plants'] += int(nums[0])
                        except: pass
                
                # Joining IDs and Names
                for f in JOIN_FIELDS:
                    val = next_props.get(f)
                    if val and str(val) not in aggregated['joined_ids']:
                        aggregated['joined_ids'].append(str(val))

            # 4. Finalize merged property strings
            if aggregated['total_plants'] > 0:
                # Update the main "No. of Plants" fields
                count_str = str(aggregated['total_plants'])
                for f in SUM_FIELDS:
                    if f in new_props: new_props[f] = count_str
            
            unique_ids = []
            for item in aggregated['joined_ids']:
                if item and item not in unique_ids: unique_ids.append(item)
            
            if unique_ids:
                id_str = ", ".join(unique_ids)
                for f in JOIN_FIELDS:
                    if f in new_props: new_props[f] = id_str

            # --- Finalize Feature ---
            def sanitize(obj):
                if isinstance(obj, dict): return {k: sanitize(v) for k, v in obj.items()}
                elif isinstance(obj, list): return [sanitize(v) for v in obj]
                elif hasattr(obj, 'item'): return obj.item()
                return obj

            # Robust ID extraction
            primary = features[0]
            f_id = (primary.get('_id') or primary.get('id') or 
                    primary.get('properties', {}).get('_id') or 
                    primary.get('properties', {}).get('id'))

            return {
                'type': 'Feature',
                'geometry': sanitize(mapping(merged_geom)),
                'properties': new_props,
                '_id': f_id
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise Exception(f"Merge failed: {str(e)}")
