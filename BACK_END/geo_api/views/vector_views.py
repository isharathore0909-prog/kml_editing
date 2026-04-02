import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .utils import _get_session_id, _get_feature_id, geometry_service, history_service, tiling_service

@csrf_exempt
def vector_operation(request):
    """
    Handles vector data operations using GeometryService.
    """
    if request.method != 'POST': 
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        data = json.loads(request.body)
        op = data.get('operation')
        features = data.get('features', [])
        session_id = _get_session_id(request)
        
        if op == 'update_vertex' and features:
            old_feature = features[0]
            updated = geometry_service.update_vertex(
                old_feature, data.get('vertex_path', {}), 
                data.get('new_lng'), data.get('new_lat')
            )
            feature_id = _get_feature_id(updated)
            history_service.push_action(session_id, 'update', feature_id, old_feature, updated)
            
            # Sync with disk chunks if tiled
            if tiling_service.is_tiled(session_id):
                tiling_service.update_feature_in_chunks(session_id, old_feature, updated)
            
            # Invalidate overlap cache
            from .utils import overlap_service
            overlap_service.invalidate_cache(session_id)
                
            return JsonResponse({'features': [updated], **history_service.get_status(session_id)})
            
        if op == 'delete_feature' and features:
            feature_to_delete = features[0]
            feature_id = _get_feature_id(feature_to_delete)
            history_service.push_action(session_id, 'delete', feature_id, old_data=feature_to_delete)
            
            # Sync with disk chunks if tiled
            if tiling_service.is_tiled(session_id):
                tiling_service.delete_feature_from_chunks(session_id, feature_to_delete)
            
            # Invalidate overlap cache
            from .utils import overlap_service
            overlap_service.invalidate_cache(session_id)
                
            return JsonResponse({'status': 'ok', **history_service.get_status(session_id)})

        if op == 'merge_features' and len(features) >= 2:
            merged_feature = geometry_service.merge_features(features)
            if not merged_feature:
                return JsonResponse({'error': 'Merging failed to produce a valid result.'}, status=400)
            
            # Record a composite action: delete others, update the first one
            composite = []
            primary = features[0]
            primary_id = _get_feature_id(primary)
            
            composite.append({
                'type': 'update',
                'feature_id': primary_id,
                'old_data': primary,
                'new_data': merged_feature
            })
            # 2. Others are deleted
            for other in features[1:]:
                composite.append({
                    'type': 'delete',
                    'feature_id': _get_feature_id(other),
                    'old_data': other,
                    'new_data': None
                })
            
            history_service.push_action(session_id, None, None, composite=composite)
            
            # Sync with disk chunks if tiled
            if tiling_service.is_tiled(session_id):
                # 1. Update the primary feature with the merged geometry
                tiling_service.update_feature_in_chunks(session_id, primary, merged_feature)
                
                # 2. Delete the other features, but ONLY if they have different IDs than the primary!
                # If they have the same ID, they were already 'updated' by the call above.
                for other in features[1:]:
                    other_id = _get_feature_id(other)
                    if str(other_id) != str(primary_id):
                        tiling_service.delete_feature_from_chunks(session_id, other)
            
            # Invalidate overlap cache
            from .utils import overlap_service
            overlap_service.invalidate_cache(session_id)

            return JsonResponse({
                'merged_feature': merged_feature,
                'deleted_ids': [
                    (f.get('_id') or f.get('id') or f.get('properties', {}).get('_id') or f.get('properties', {}).get('id'))
                    for f in features[1:]
                ],
                **history_service.get_status(session_id)
            })

        return JsonResponse({'error': f'Unsupported op: {op}'}, status=400)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)
