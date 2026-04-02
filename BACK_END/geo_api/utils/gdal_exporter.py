import os
import subprocess
import tempfile
import json
import shutil

# Common paths for OSGeo4W on Windows
OSGEO4W_PATHS = [
    r"C:\OSGeo4W\bin\ogr2ogr.exe",
    r"C:\OSGeo4W64\bin\ogr2ogr.exe",
    r"C:\Program Files\QGIS 3.34.1\bin\ogr2ogr.exe", # common QGIS path
    r"C:\Program Files\QGIS 3.28.1\bin\ogr2ogr.exe",
]

def find_ogr2ogr():
    # 1. Check if in PATH
    path = shutil.which("ogr2ogr")
    if path:
        return path
    
    # 2. Check common installation paths
    for p in OSGEO4W_PATHS:
        if os.path.exists(p):
            return p
            
    return None

def export_with_gdal(features, output_format, output_path):
    """
    Exports features to a given format using ogr2ogr.
    features: List of GeoJSON features or a GeoJSON-like dict
    output_format: 'KML' etc.
    output_path: Destination path
    """
    ogr2ogr_path = find_ogr2ogr()
    if not ogr2ogr_path:
        raise Exception("ogr2ogr not found in PATH or common OSGeo4W locations (C:\\OSGeo4W\\bin\\ogr2ogr.exe).")

    # Ensure we have a valid GeoJSON structure
    if isinstance(features, list):
        geojson_data = {"type": "FeatureCollection", "features": features}
    elif isinstance(features, dict):
        if 'type' not in features:
            geojson_data = {"type": "FeatureCollection", "features": features.get('features', [])}
        else:
            geojson_data = features
    else:
        raise Exception(f"Unsupported features type: {type(features)}")

    # Create temporary GeoJSON file
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False, mode='w', encoding='utf-8') as tmp_json:
        json.dump(geojson_data, tmp_json)
        tmp_json_path = tmp_json.name

    try:
        # Run ogr2ogr
        # -f: output format
        # -overwrite: overwrite output file
        # -skipfailures: skip features that fail to convert
        cmd = [
            ogr2ogr_path,
            "-f", output_format,
            output_path,
            tmp_json_path,
            "-overwrite",
            "-skipfailures"
        ]
        
        # Add specific options for KML to ensure it's readable by older Google Earth versions
        if output_format == 'KML':
            cmd.extend([
                "-lco", "FORCE_2D=YES",
                "-lco", "NAME_FIELD=Name",
                "-lco", "DESCRIPTION_FIELD=Description"
            ])

        # Set environment variables for GDAL/PROJ if possible
        env = os.environ.copy()
        base_dir = os.path.dirname(os.path.dirname(ogr2ogr_path))
        # Common OSGeo4W env patterns
        gdal_data = os.path.join(base_dir, "share", "gdal")
        if os.path.exists(gdal_data): env["GDAL_DATA"] = gdal_data
        
        proj_lib = os.path.join(base_dir, "share", "proj")
        if os.path.exists(proj_lib): env["PROJ_LIB"] = proj_lib

        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        
        if result.returncode != 0:
            # If it failed, check if it's just a warning
            if "Error" in result.stderr or not os.path.exists(output_path):
                raise Exception(f"ogr2ogr failed: {result.stderr}")
            
        return True
    finally:
        if os.path.exists(tmp_json_path):
            try:
                os.remove(tmp_json_path)
            except: pass
