import os
import json
import fiona
from zipfile import ZipFile

class BaseService:
    def __init__(self):
        pass

    def ensure_drivers(self):
        """Globally enable KML/KMZ drivers for fiona."""
        try:
            fiona.drvsupport.supported_drivers['KML'] = 'rw'
            fiona.drvsupport.supported_drivers['LIBKML'] = 'rw'
        except Exception as e:
            print(f"Warning: Could not enable KML drivers: {e}")

    def _to_json_safe(self, obj):
        """Recursive helper to convert Fiona/Shapely objects to serializable dicts."""
        if hasattr(obj, 'mapping'):
            obj = obj.mapping()
        if isinstance(obj, dict):
            return {str(k): self._to_json_safe(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._to_json_safe(v) for v in obj]
        if hasattr(obj, '__geo_interface__'):
            return obj.__geo_interface__
        return obj

    def cleanup_tmp(self, path):
        """Utility to safely remove temporary files."""
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                print(f"Error cleaning up {path}: {e}")

    def _stream_features(self, file_path):
        """Standardized, stable generator to yield features from KML/KMZ/GeoJSON."""
        import tempfile
        import shutil

        # 1. Check if it's a KMZ
        is_kmz = file_path.lower().endswith('.kmz') or '.kmz' in file_path.lower()
        
        if is_kmz:
            # For KMZ, unzip to a temporary directory once for stability
            temp_dir = tempfile.mkdtemp(prefix="kmz_extract_")
            try:
                with ZipFile(file_path, 'r') as zh:
                    zh.extractall(temp_dir)
                
                # Walk the temp dir for KML files
                for root, _, files in os.walk(temp_dir):
                    for f_name in files:
                        if f_name.lower().endswith('.kml'):
                            kml_path = os.path.join(root, f_name)
                            try:
                                layers = fiona.listlayers(kml_path)
                                for layer in layers:
                                    with fiona.open(kml_path, layer=layer) as src:
                                        for feat in src:
                                            yield self._to_json_safe(feat)
                            except:
                                continue
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        else:
            # 2. Treat as GeoJSON or KML directly
            try:
                layers = fiona.listlayers(file_path)
                for layer in layers:
                    with fiona.open(file_path, layer=layer) as src:
                        for feat in src:
                            yield self._to_json_safe(feat)
            except Exception:
                # 3. Final fallback: plain JSON
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if isinstance(data, dict) and data.get('type') == 'FeatureCollection':
                            for feat in data.get('features', []):
                                yield feat
                except: pass
