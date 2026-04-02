from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .utils import _get_session_id, tiling_service

@csrf_exempt
def get_bbox_features(request):
    """
    Returns features within a specific BBox from tiled chunks.
    Expects GET params: session_id, bbox (csv: minx,miny,maxx,maxy)
    """
    session_id = _get_session_id(request)
    bbox_str = request.GET.get('bbox')
    
    print(f"[DEBUG] get_bbox_features: session={session_id}, bbox={bbox_str}")
    
    if not session_id or not bbox_str:
        return JsonResponse({'error': 'session_id and bbox required'}, status=400)
    
    try:
        parts = [float(x) for x in bbox_str.split(',')]
        if len(parts) != 4: raise ValueError("BBox must be 4 floats")
        
        result = tiling_service.get_features_in_bbox(session_id, parts)
        if result is None:
            return JsonResponse({'error': 'Not tiled'}, status=404)
            
        print(f"[DEBUG] Found {result.get('count', 0)} features in bbox (limited={result.get('limited', False)})")
        return JsonResponse(result)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
