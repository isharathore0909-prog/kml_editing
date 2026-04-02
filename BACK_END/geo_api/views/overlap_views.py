import tempfile
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .utils import _get_session_id, overlap_service, tiling_service, history_service

@csrf_exempt
def calculate_overlaps_view(request):
    """
    Handles file upload and overlap calculation using OverlapService.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    if 'file' not in request.FILES:
        return JsonResponse({'error': 'No file uploaded'}, status=400)

    uploaded_file = request.FILES['file']
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.kmz')
    tmp_path = tmp.name
    
    try:
        for chunk in uploaded_file.chunks():
            tmp.write(chunk)
        tmp.close()  # Close for Windows compatibility
        
        # Sanitize session_id for Windows filesystem (remove :, *, ?, etc.)
        session_id = _get_session_id(request)
        
        print(f"[*] Processing file: {uploaded_file.name} ({uploaded_file.size} bytes)")
        
        # 1. Tiling & History Reset
        # Whenever a file is EXPLICITLY uploaded, we must clear old session data
        # To ensure a "blank slate" as requested by the user.
        print(f"[*] Resetting session data for {session_id}...")
        history_service.clear(session_id)
        
        # Always process large file if uploaded (wipes old chunks if they exist)
        tiling_service.process_large_file(tmp_path, session_id)
        
        # 2. Overlap Calculation
        skip_overlaps = request.GET.get('skip_overlaps') == 'true'
        
        if not skip_overlaps:
            print(f"[*] Overlap calculation started...")
            df, involved_count = overlap_service.calculate_overlaps(tmp_path, session_id=session_id)
            print(f"[*] Overlap calculation finished. Found {len(df) if df is not None else 0} overlaps.")
        else:
            print(f"[*] Skipping overlap calculation as requested.")
            df = None
            involved_count = None

        is_large = tiling_service.is_tiled(session_id)
        
        if not skip_overlaps and df is None:
            return JsonResponse({'error': 'Processing failed to yield data'}, status=400)
            
        fmt = request.GET.get('format', 'csv')
        filename = f"overlaps_{uploaded_file.name}"

        if fmt == 'json':
            response_data = {
                'isTiled': bool(is_large),
                'bounds': overlap_service.get_total_bounds(tmp_path)
            }
            if not skip_overlaps and df is not None:
                response_data.update({
                    'overlapCount': len(df),
                    'involvedCount': involved_count,
                    'pairs': df.to_dict(orient='records')
                })
            else:
                response_data.update({
                    'overlapCount': None,
                    'involvedCount': None,
                    'pairs': []
                })
            return JsonResponse(response_data)

        if skip_overlaps:
             return JsonResponse({'message': 'Tiling completed, overlaps skipped', 'isTiled': True})

        if df.empty:
            return JsonResponse({
                'message': 'No overlaps found in this dataset', 
                'pairs': [], 
                'isTiled': bool(is_large)
            })

        # Columns formatting
        column_order = [
            "Plantation ID", "Plantation By (Department)", "Plants Name", "No. of Plants", 
            "Area (Text)", "Actual Area (hectares)", "Created At",
            "Overlapping Plantation ID", "Overlapping Plantation By", 
            "Overlapping Plants Name", "Overlapping No. of Plants",
            "Overlapping Area (Text)", "Overlapping Actual Area (hectares)",
            "Overlapping Created At", "Overlap Area (Hectares)"
        ]
        final_columns = [col for col in column_order if col in df.columns]
        df = df[final_columns]

        # Visually group duplicates just like the frontend OverlapsModal
        if "Plantation By (Department)" in df.columns and "Plantation ID" in df.columns:
            # Create sort keys
            df['sort_dept'] = df['Plantation By (Department)'].astype(str).str.strip().str.lower()
            df['sort_id'] = df['Plantation ID'].astype(str).str.strip()
            # Sort identically to frontend
            df.sort_values(by=['sort_dept', 'sort_id'], inplace=True)
            df.drop(columns=['sort_dept', 'sort_id'], inplace=True)
            df.reset_index(drop=True, inplace=True)

        if "Plantation ID" in df.columns:
            is_dupe = df["Plantation ID"] == df["Plantation ID"].shift(1)
            blankable_columns = ["Plantation ID", "Plantation By (Department)", "Plants Name", "No. of Plants", "Area (Text)", "Actual Area (hectares)", "Created At"]
            for col in blankable_columns:
                if col in df.columns:
                    df.loc[is_dupe, col] = ""

        if fmt == 'xlsx':
            try:
                import openpyxl
                response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                response['Content-Disposition'] = f'attachment; filename="{filename}.xlsx"'
                df.to_excel(response, index=False)
                return response
            except ImportError:
                return JsonResponse({'error': 'Excel export requires openpyxl library'}, status=501)

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}.csv"'
        df.to_csv(response, index=False, encoding='utf-8-sig')
        return response

    except Exception as e:
        return JsonResponse({'error': f'Server error: {str(e)}'}, status=500)
    finally:
        overlap_service.cleanup_tmp(tmp_path)
