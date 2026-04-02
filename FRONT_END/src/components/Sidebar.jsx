import React from 'react';
import { UploadZone } from './sidebar/UploadZone';
import { FilePanel } from './sidebar/FilePanel';
import { StatusPanel } from './sidebar/StatusPanel';

/**
 * Sidebar is now a thin layout shell organizing sub-components.
 */
export const Sidebar = React.memo(function Sidebar() {
    return (
        <aside className="sidebar">
            <UploadZone />
            <StatusPanel />
            <FilePanel />
        </aside>
    );
});
