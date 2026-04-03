import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .utils import _get_session_id, history_service, tiling_service, overlap_service

@csrf_exempt
def history_push(request):
    """Records a manual action into history."""
    if request.method != 'POST': return JsonResponse({'error': 'POST required'}, status=405)
    try:
        session_id = _get_session_id(request)
        data = json.loads(request.body)
        
        history_service.push_action(
            session_id,
            data.get('action_type'),
            data.get('feature_id'),
            data.get('old_data'),
            data.get('new_data')
        )
        return JsonResponse({
            'status': 'ok', 
            **history_service.get_status(session_id)
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def history_undo(request):
    session_id = _get_session_id(request)
    formatted, raw = history_service.undo(session_id)
    if formatted:
        # Sync with disk chunks if tiled
        if tiling_service.is_tiled(session_id):
            _sync_history_action_to_chunks(session_id, raw, is_undo=True)
        
        # Invalidate overlap cache
        overlap_service.invalidate_cache(session_id)
            
        return JsonResponse({
            'status': 'ok', 
            'action': formatted,
            **history_service.get_status(session_id)
        })
    return JsonResponse({'status': 'error', 'message': 'No more undo history'}, status=404)

@csrf_exempt
def history_redo(request):
    session_id = _get_session_id(request)
    formatted, raw = history_service.redo(session_id)
    if formatted:
        # Sync with disk chunks if tiled
        if tiling_service.is_tiled(session_id):
            _sync_history_action_to_chunks(session_id, raw, is_undo=False)
        
        # Invalidate overlap cache
        overlap_service.invalidate_cache(session_id)
            
        return JsonResponse({
            'status': 'ok', 
            'action': formatted,
            **history_service.get_status(session_id)
        })
    return JsonResponse({'status': 'error', 'message': 'No more redo history'}, status=404)

def _sync_history_action_to_chunks(session_id, action, is_undo=False):
    """Propagates a history action back to the disk-based tiled storage."""
    # Handle composite actions (like Merges)
    if 'composite' in action:
        for sub in action['composite']:
            _sync_history_action_to_chunks(session_id, sub, is_undo=is_undo)
        return

    a_type = action.get('type') or action.get('action_type')
    f_id = action.get('feature_id')
    old_data = action.get('old_data')
    new_data = action.get('new_data')
    v_delta = action.get('vertex_delta')

    # Undo: swap new and old
    if is_undo:
        old_data, new_data = new_data, old_data
        if v_delta:
            # Swap positions in delta
            v_delta = v_delta.copy()
            v_delta['old_pos'], v_delta['new_pos'] = v_delta['new_pos'], v_delta['old_pos']

    # 1. Update/Restore
    if a_type == 'update':
        tiling_service.update_feature_in_chunks(session_id, old_data, new_data)
    elif a_type == 'delete':
        if is_undo: # restored
            tiling_service.update_feature_in_chunks(session_id, None, new_data)
        else: # deleted
            tiling_service.delete_feature_from_chunks(session_id, old_data)
    elif a_type == 'vertex' and v_delta:
        # For tiled vertex edits, we need to find the feature in chunks first
        # We'll use the new position to find the correct chunk cell
        res = tiling_service.get_features_in_bbox(session_id, [v_delta['new_pos'][0]-0.001, v_delta['new_pos'][1]-0.001, v_delta['new_pos'][0]+0.001, v_delta['new_pos'][1]+0.001])
        feats = res.get('features', []) if res else []
        target = next((f for f in feats if (f.get('_id') or f.get('id')) == f_id), None)
        if target:
            from ..services.geometry_service import GeometryService
            gs = GeometryService()
            updated = gs.update_vertex(target, v_delta['path'], v_delta['new_pos'][0], v_delta['new_pos'][1])
            tiling_service.update_feature_in_chunks(session_id, target, updated)

@csrf_exempt
def history_status(request):
    """Returns the current undo/redo availability for a session (read-only, no mutation)."""
    session_id = _get_session_id(request)
    return JsonResponse(history_service.get_status(session_id))

@csrf_exempt
def record_vertex_edit(request):
    """
    Lightweight endpoint: records a vertex edit using minimal delta.
    Expects JSON body:
      session_id, feature_id, vertex_path, old_pos, new_pos
      (pos is [lng, lat])
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        session_id = _get_session_id(request)
        body = json.loads(request.body)
        feature_id = body.get('feature_id')
        vertex_path = body.get('vertex_path')
        old_pos = body.get('old_pos')
        new_pos = body.get('new_pos')

        if not feature_id or not vertex_path:
            return JsonResponse({'error': 'feature_id and vertex_path required'}, status=400)

        history_service.push_action(
            session_id, 'update', feature_id, 
            vertex_delta={'path': vertex_path, 'old_pos': old_pos, 'new_pos': new_pos}
        )
        
        # Sync with disk chunks if tiled
        if tiling_service.is_tiled(session_id):
            # Use both old and new positions to define search area, with a small buffer
            search_pts = [new_pos]
            if old_pos: search_pts.append(old_pos)
            
            lons = [p[0] for p in search_pts]
            lats = [p[1] for p in search_pts]
            
            # Add 0.001 degree buffer (~100m) for safety
            bbox = [min(lons) - 0.001, min(lats) - 0.001, 
                    max(lons) + 0.001, max(lats) + 0.001]
            result = tiling_service.get_features_in_bbox(session_id, bbox)
            features = result.get('features', []) if result else None
            if features:
                target = next((f for f in features if (f.get('_id') or f.get('id') or f.get('properties', {}).get('_id') or f.get('properties', {}).get('id')) == feature_id), None)
                if target:
                    from ..services.geometry_service import GeometryService
                    gs = GeometryService()
                    updated = gs.update_vertex(target, vertex_path, new_pos[0], new_pos[1])
                    tiling_service.update_feature_in_chunks(session_id, target, updated)

        return JsonResponse({'status': 'ok', **history_service.get_status(session_id)})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def record_deletion(request):
    """
    Lightweight endpoint: records a feature deletion in history.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        session_id = _get_session_id(request)
        body = json.loads(request.body)
        feature = body.get('feature')
        
        if not feature or not feature.get('_id'):
            return JsonResponse({'error': 'Feature with _id required'}, status=400)

        history_service.push_action(session_id, 'delete', feature.get('_id'), old_data=feature)
        
        # Sync with disk chunks if tiled
        if tiling_service.is_tiled(session_id):
            tiling_service.delete_feature_from_chunks(session_id, feature)
            
        return JsonResponse({'status': 'ok', **history_service.get_status(session_id)})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
