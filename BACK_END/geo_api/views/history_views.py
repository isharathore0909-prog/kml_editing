import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .utils import _get_session_id, history_service, tiling_service, geometry_service

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
    formatted_actions, raw_action = history_service.undo(session_id)
    if formatted_actions:
        # Side effect: Sync with disk chunks if tiled
        if tiling_service.is_tiled(session_id):
            _sync_history_action_to_chunks(session_id, raw_action, is_undo=True)
        
        # Invalidate overlap cache - any history action changes geometry/structure
        from .utils import overlap_service
        overlap_service.invalidate_cache(session_id)
            
        return JsonResponse({
            'status': 'ok', 
            'action': formatted_actions,
            **history_service.get_status(session_id)
        })
    return JsonResponse({'status': 'error', 'message': 'No more undo history'}, status=404)

@csrf_exempt
def history_redo(request):
    session_id = _get_session_id(request)
    formatted_actions, raw_action = history_service.redo(session_id)
    if formatted_actions:
        # Side effect: Sync with disk chunks if tiled
        if tiling_service.is_tiled(session_id):
            _sync_history_action_to_chunks(session_id, raw_action, is_undo=False)
            
        # Invalidate overlap cache
        from .utils import overlap_service
        overlap_service.invalidate_cache(session_id)
            
        return JsonResponse({
            'status': 'ok', 
            'action': formatted_actions,
            **history_service.get_status(session_id)
        })
    return JsonResponse({'status': 'error', 'message': 'No more redo history'}, status=404)

def _sync_history_action_to_chunks(session_id, raw_action, is_undo=True):
    """
    Synchronizes a history action back to disk chunks.
    Ensures undo/redo survives map refreshes in tiled sessions.
    """
    if 'composite' in raw_action:
        # For composite, we must process in REVERSE order if undoing
        actions = raw_action['composite']
        if is_undo:
            actions = reversed(actions)
        for sub in actions:
            _sync_history_action_to_chunks(session_id, sub, is_undo)
        return

    atype = raw_action.get('type')
    fid = raw_action.get('feature_id')
    old_data = raw_action.get('old_data')
    new_data = raw_action.get('new_data')
    v_delta = raw_action.get('vertex_delta')

    if v_delta:
        # Vertex edit sync
        target_pos = v_delta['old_pos'] if is_undo else v_delta['new_pos']
        # Find feature in chunks to apply vertex update
        bbox = [target_pos[0] - 0.001, target_pos[1] - 0.001, 
                target_pos[0] + 0.001, target_pos[1] + 0.001]
        result = tiling_service.get_features_in_bbox(session_id, bbox)
        features = result.get('features', []) if result else []
        target = next((f for f in features if (f.get('_id') or f.get('id') or f.get('properties', {}).get('_id') or f.get('properties', {}).get('id')) == fid), None)
        if target:
            updated_geom = geometry_service.update_vertex(target, v_delta['path'], target_pos[0], target_pos[1])
            new_feat = {**target, 'geometry': updated_geom}
            tiling_service.update_feature_in_chunks(session_id, target, new_feat)

    elif atype == 'add':
        if is_undo:
            if new_data: tiling_service.delete_feature_from_chunks(session_id, new_data)
        else:
            if new_data: tiling_service.update_feature_in_chunks(session_id, None, new_data)

    elif atype == 'delete':
        if is_undo:
            if old_data: tiling_service.update_feature_in_chunks(session_id, None, old_data)
        else:
            if old_data: tiling_service.delete_feature_from_chunks(session_id, old_data)

    elif atype == 'update':
        if is_undo:
            if old_data and new_data: tiling_service.update_feature_in_chunks(session_id, new_data, old_data)
        else:
            if old_data and new_data: tiling_service.update_feature_in_chunks(session_id, old_data, new_data)

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
        
        # Invalidate overlap cache
        from .utils import overlap_service
        overlap_service.invalidate_cache(session_id)

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
            
        # Invalidate overlap cache
        from .utils import overlap_service
        overlap_service.invalidate_cache(session_id)
            
        return JsonResponse({'status': 'ok', **history_service.get_status(session_id)})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
