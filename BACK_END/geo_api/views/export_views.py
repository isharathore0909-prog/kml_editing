import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .utils import export_service

@csrf_exempt
def export_layer(request):
    """
    Exports GeoJSON features using ExportService.
    """
    if request.method != 'POST': 
        return JsonResponse({'error': 'POST required'}, status=405)
    
    try:
        from .utils import _get_session_id
        session_id = _get_session_id(request)
        
        data = json.loads(request.body)
        fmt = request.GET.get('format', 'geojson')
        name = request.GET.get('filename', 'exported')
        
        return export_service.export_features(data, fmt, name, session_id=session_id)
        
    except Exception as e:
        return JsonResponse({'error': f"Export failed: {str(e)}"}, status=500)
