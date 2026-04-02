import { useCallback } from 'react';

/**
 * Encapsulates all file-upload / drag-and-drop logic so Sidebar doesn't
 * need to know anything about the worker or state resetting.
 */
export function useFileUpload({ processFile, fileInputRef, setIsDragging }) {
    const ACCEPTED_EXTS = ['.json', '.geojson', '.kml', '.kmz'];

    const isValidFile = useCallback((file) => {
        if (!file) return false;
        const name = file.name.toLowerCase();
        return ACCEPTED_EXTS.some(ext => name.endsWith(ext));
    }, []);

    const handleFileChange = useCallback((e) => {
        const file = e.target.files[0];
        if (file && isValidFile(file)) processFile(file);
    }, [processFile, isValidFile]);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, [setIsDragging]);

    const handleDragLeave = useCallback(() => {
        setIsDragging(false);
    }, [setIsDragging]);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && isValidFile(file)) processFile(file);
        else if (file) alert('Please drop a .json, .geojson, .kml, or .kmz file.');
    }, [processFile, setIsDragging, isValidFile]);

    const openFilePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, [fileInputRef]);

    return { handleFileChange, handleDragOver, handleDragLeave, handleDrop, openFilePicker };
}
