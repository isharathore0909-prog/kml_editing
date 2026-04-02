import os
import json
import io
import tempfile
import pandas as pd
import geopandas as gpd
from zipfile import ZipFile, ZIP_DEFLATED
from django.http import HttpResponse, JsonResponse
from shapely.ops import transform
from ..utils.gdal_exporter import export_with_gdal
from .base_service import BaseService

class ExportService(BaseService):
    def __init__(self):
        super().__init__()
        self.ensure_drivers()

    def sanitize_features(self, features):
        """Sanitize GeoJSON features for GeoPandas to avoid inhomogeneous shape errors."""
        sanitized = []
        for feat in features:
            s_feat = feat.copy()
            if 'properties' in s_feat and isinstance(s_feat['properties'], dict):
                s_props = {}
                for k, v in s_feat['properties'].items():
                    if isinstance(v, (list, dict)):
                        s_props[k] = json.dumps(v)
                    else:
                        s_props[k] = v
                s_feat['properties'] = s_props
            sanitized.append(s_feat)
        return sanitized

    def finalize_geom(self, geom):
        """Force 2D and fix validity of geometry."""
        if geom is None or geom.is_empty: return None
        if hasattr(geom, 'has_z') and geom.has_z:
            geom = transform(lambda x, y, z=None: (x, y), geom)
        try:
            if not geom.is_valid:
                geom = geom.buffer(0)
        except: pass
        return geom

    def export_features(self, data, fmt, filename):
        """Main entry point for exporting features."""
        fmt = fmt.lower()
        clean_name = "".join([c for c in filename if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
        if not clean_name: clean_name = "exported_geodata"

        if fmt == 'geojson':
            res = HttpResponse(json.dumps(data), content_type='application/json')
            res['Content-Disposition'] = f'attachment; filename="{clean_name}.geojson"'
            return res

        features = data.get('features', [])
        if not features:
            return JsonResponse({'error': 'No features to export'}, status=400)

        # Try GDAL first for KML/KMZ as it's more robust
        if fmt in ['kml', 'kmz']:
            res = self._export_spatial_gdal(data, fmt, clean_name)
            if res:
                return res
            # If GDAL fails, work continues below to fallback path

        # Fallback to GeoPandas for other formats
        sanitized = self.sanitize_features(features)
        try:
            gdf = gpd.GeoDataFrame.from_features(sanitized, crs="EPSG:4326")
        except Exception as e:
            return JsonResponse({'error': f'Failed to create GeoDataFrame: {str(e)}'}, status=500)

        if gdf.empty:
            return JsonResponse({'error': 'Dataset is empty or contains no valid features'}, status=400)

        if fmt in ['csv', 'xlsx']:
            return self._export_tabular(gdf, fmt, clean_name)

        # Final fallback/advanced spatial export via Fiona if needed
        return self._export_spatial_fiona(gdf, fmt, clean_name)

    def _export_spatial_gdal(self, data, fmt, filename):
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.kml')
        tmp_path = tmp.name
        tmp.close()
        
        try:
            if export_with_gdal(data, 'KML', tmp_path):
                if fmt == 'kml':
                    with open(tmp_path, 'rb') as f: content = f.read()
                    res = HttpResponse(content, content_type='application/vnd.google-earth.kml+xml')
                    res['Content-Disposition'] = f'attachment; filename="{filename}.kml"'
                    return res
                else: # KMZ
                    kmz_io = io.BytesIO()
                    with ZipFile(kmz_io, 'w', ZIP_DEFLATED) as kmz:
                        kmz.write(tmp_path, arcname='doc.kml')
                    res = HttpResponse(kmz_io.getvalue(), content_type='application/vnd.google-earth.kmz')
                    res['Content-Disposition'] = f'attachment; filename="{filename}.kmz"'
                    return res
        finally:
            self.cleanup_tmp(tmp_path)
        
        return None # Indicate GDAL failed

    def _export_tabular(self, gdf, fmt, filename):
        df_export = pd.DataFrame(gdf.drop(columns='geometry'))
        if fmt == 'csv':
            response = HttpResponse(content_type='text/csv')
            response['Content-Disposition'] = f'attachment; filename="{filename}.csv"'
            df_export.to_csv(response, index=False, encoding='utf-8-sig')
            return response
        
        if fmt == 'xlsx':
            try:
                import openpyxl
                response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                response['Content-Disposition'] = f'attachment; filename="{filename}.xlsx"'
                df_export.to_excel(response, index=False)
                return response
            except ImportError:
                return JsonResponse({'error': 'Excel export requires openpyxl library'}, status=501)
        return None

    def _export_spatial_fiona(self, gdf, fmt, filename):
        # Additional sanitization for Fiona
        gdf['geometry'] = gdf.geometry.map(self.finalize_geom)
        gdf = gdf[gdf.geometry.notnull()].copy()

        if 'id' in gdf.columns: gdf = gdf.rename(columns={'id': 'orig_id'})
        for col in gdf.columns:
            if col != 'geometry':
                gdf[col] = gdf[col].apply(lambda x: json.dumps(x) if isinstance(x, (list, dict)) else str(x) if x is not None else "")

        if 'Name' not in gdf.columns:
            for p in ['name', 'Name', 'title', 'Plantation ID', 'id', 'orig_id']:
                if p in gdf.columns:
                    gdf['Name'] = gdf[p]
                    break

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.kml')
        tmp_path = tmp.name
        tmp.close()
        
        try:
            gdf.to_file(tmp_path, driver='KML', engine='fiona')
            if fmt == 'kml':
                with open(tmp_path, 'rb') as f: content = f.read()
                res = HttpResponse(content, content_type='application/vnd.google-earth.kml+xml')
                res['Content-Disposition'] = f'attachment; filename="{filename}.kml"'
                return res
            else: # kmz
                kmz_io = io.BytesIO()
                with ZipFile(kmz_io, 'w', ZIP_DEFLATED) as kmz:
                    kmz.write(tmp_path, arcname='doc.kml')
                res = HttpResponse(kmz_io.getvalue(), content_type='application/vnd.google-earth.kmz')
                res['Content-Disposition'] = f'attachment; filename="{filename}.kmz"'
                return res
        except Exception as e:
            return JsonResponse({'error': f'Spatial export failed: {str(e)}'}, status=500)
        finally:
            self.cleanup_tmp(tmp_path)
