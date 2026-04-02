from django.urls import path
from .views import (
    calculate_overlaps_view, vector_operation, export_layer,
    history_push, history_undo, history_redo, history_status, record_vertex_edit,
    record_deletion, get_bbox_features
)

urlpatterns = [
    path('calculate-overlaps/', calculate_overlaps_view, name='calculate_overlaps'),
    path('vector-operation/', vector_operation, name='vector_operation'),
    path('export-layer/', export_layer, name='export_layer'),
    path('history/push/', history_push, name='history_push'),
    path('history/undo/', history_undo, name='history_undo'),
    path('history/redo/', history_redo, name='history_redo'),
    path('history/status/', history_status, name='history_status'),
    path('history/record-vertex-edit/', record_vertex_edit, name='record_vertex_edit'),
    path('history/record-deletion/', record_deletion, name='record_deletion'),
    path('get-bbox-features/', get_bbox_features, name='get_bbox_features'),
]
