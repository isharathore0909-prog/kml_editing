import json
import re

from ..services.overlap_service import OverlapService
from ..services.export_service import ExportService
from ..services.geometry_service import GeometryService
from ..services.history_service import HistoryService
from ..services.tiling_service import TilingService

# Instantiate services
overlap_service = OverlapService()
export_service = ExportService()
geometry_service = GeometryService()
history_service = HistoryService()
tiling_service = TilingService()

def _get_session_id(request):
    """Sanitize and normalize session_id for Windows filesystem consistency."""
    val = request.POST.get('session_id') or request.GET.get('session_id')
    if not val and request.content_type == 'application/json':
        try:
            val = json.loads(request.body).get('session_id')
        except: pass
    
    val = (val or 'default').lower()
    # Replace all non-alphanumeric (except . and _) with a single dash
    normalized = re.sub(r'[^a-z0-9._]+', '-', val).strip('-')
    return normalized or 'default'

def _get_feature_id(feature):
    if not feature: return None
    return (feature.get('_id') or feature.get('id') or 
            feature.get('properties', {}).get('_id') or 
            feature.get('properties', {}).get('id'))
