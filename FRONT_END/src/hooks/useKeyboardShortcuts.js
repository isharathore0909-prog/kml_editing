import { useEffect, useCallback } from 'react';

/**
 * Registers global keyboard shortcuts for the map editor.
 * All handlers are stable references — the effect only re-registers
 * when the handler functions change.
 */
export function useKeyboardShortcuts({ undo, redo, canUndo, canRedo, setToolMode, setEditingFeatureId, setMergeSelection }) {
    const handleKeyDown = useCallback((e) => {
        const tag = document.activeElement?.tagName;
        // Don't intercept shortcuts when user is typing in an input/textarea
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
                return;
            }
            if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                e.preventDefault();
                if (canRedo) redo();
                return;
            }
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            setToolMode('view');
            setEditingFeatureId(null);
            setMergeSelection([]);
        }
    }, [undo, redo, canUndo, canRedo, setToolMode, setEditingFeatureId, setMergeSelection]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
