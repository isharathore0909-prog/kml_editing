from .base_service import BaseService

class HistoryService(BaseService):
    def __init__(self):
        super().__init__()
        # In-memory session-based history of ACTIONS
        # Format: { session_id: { 'undo': [action1, action2, ...], 'redo': [...] } }
        self._sessions = {}
        self._max_history = 100

    def push_action(self, session_id, action_type, feature_id, old_data=None, new_data=None, composite=None, vertex_delta=None):
        """
        Records an action or a composite list of actions.
        - composite: list of {type, feature_id, old_data, new_data, vertex_delta}
        - vertex_delta: {path, old_pos, new_pos} where pos is [lng, lat]
        """
        if not session_id:
            session_id = "default"
            
        if session_id not in self._sessions:
            self._sessions[session_id] = {'undo': [], 'redo': []}
            
        session = self._sessions[session_id]
        
        if composite:
            action_entry = {'composite': composite}
        elif vertex_delta:
            action_entry = {
                'type': 'vertex',
                'feature_id': feature_id,
                'vertex_delta': vertex_delta
            }
        else:
            action_entry = {
                'type': action_type,
                'feature_id': feature_id,
                'old_data': old_data,
                'new_data': new_data
            }
        
        session['undo'].append(action_entry)
        session['redo'] = []
            
        if len(session['undo']) > self._max_history:
            session['undo'].pop(0)
        
        return len(session['undo'])

    def _format_action(self, action, is_undo=True):
        if 'composite' in action:
            return [self._format_single_action(a, is_undo) for a in action['composite']]
        return [self._format_single_action(action, is_undo)]

    def _format_single_action(self, action, is_undo=True):
        if action.get('type') == 'vertex':
            delta = action['vertex_delta']
            return {
                'type': 'vertex',
                'feature_id': action['feature_id'],
                'path': delta['path'],
                'pos': delta['old_pos'] if is_undo else delta['new_pos']
            }

        if is_undo:
            # Instruction: how to REVERSE this action
            new_type = 'delete' if action['type'] == 'add' else ('add' if action['type'] == 'delete' else 'update')
            return {
                'type': new_type,
                'feature_id': action['feature_id'],
                'data': action['old_data'] if action['type'] in ['update', 'delete'] else None
            }
        else:
            # Instruction: how to RE-APPLY this action
            return {
                'type': action['type'],
                'feature_id': action['feature_id'],
                'data': action['new_data'] if action['type'] in ['update', 'add'] else None
            }

    def undo(self, session_id):
        """Returns a list of actions to REVERSE the last thing done."""
        if not session_id or session_id not in self._sessions or not self._sessions[session_id]['undo']:
            return None
            
        session = self._sessions[session_id]
        action = session['undo'].pop()
        session['redo'].append(action)
        
        return self._format_action(action, is_undo=True)

    def redo(self, session_id):
        """Returns a list of actions to RE-APPLY the last undone thing."""
        if not session_id or session_id not in self._sessions or not self._sessions[session_id]['redo']:
            return None
            
        session = self._sessions[session_id]
        action = session['redo'].pop()
        session['undo'].append(action)
        
        return self._format_action(action, is_undo=False)

    def get_status(self, session_id):
        if session_id not in self._sessions:
            return {'can_undo': False, 'can_redo': False}
        return {
            'can_undo': len(self._sessions[session_id]['undo']) > 0,
            'can_redo': len(self._sessions[session_id]['redo']) > 0
        }

    def clear(self, session_id):
        if session_id in self._sessions:
            del self._sessions[session_id]
