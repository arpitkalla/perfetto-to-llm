/**
 * Perfetto Trace Viewer - Main Application
 * Connects all components and handles UI interactions
 */

class App {
    constructor() {
        // Components
        this.parser = new TraceParser();
        this.viewer = null;
        this.exporter = new LLMExporter();

        // State
        this.traceData = null;
        this.selectedSlices = [];
        this.currentMode = 'select'; // Default to select mode

        // Initialize
        this.initViewer();
        this.bindEvents();
        this.updateModeButtons(); // Set correct initial button state
        this.updateStatus('Ready - Load a Perfetto trace or click "Load Demo Trace" to begin');
    }

    /**
     * Initialize the trace viewer
     */
    initViewer() {
        const canvasContainer = document.getElementById('canvasContainer');
        const trackLabels = document.getElementById('trackLabels');
        const rulerCanvas = document.getElementById('rulerCanvas');

        this.viewer = new TraceViewer(canvasContainer, trackLabels, rulerCanvas);

        // Set up callbacks
        this.viewer.onSliceClick = this.handleSliceClick.bind(this);
        this.viewer.onSliceHover = this.handleSliceHover.bind(this);
        this.viewer.onSelectionChange = this.handleSelectionChange.bind(this);
        this.viewer.onViewChange = this.handleViewChange.bind(this);
        this.viewer.onModeChange = this.handleModeChange.bind(this);
        this.viewer.onTrackVisibilityChange = this.handleTrackVisibilityChange.bind(this);

        // Initialize cursor
        this.viewer.updateCursor();
    }

    /**
     * Bind UI event handlers
     */
    bindEvents() {
        // File input
        document.getElementById('traceFileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadTraceFile(e.target.files[0]);
            }
        });

        // Demo trace button
        document.getElementById('loadDemoBtn').addEventListener('click', () => {
            this.loadDemoTrace();
        });

        // Mode toggle buttons
        document.getElementById('panModeBtn').addEventListener('click', () => {
            this.setMode('pan');
        });

        document.getElementById('selectModeBtn').addEventListener('click', () => {
            this.setMode('select');
        });

        // Zoom controls
        document.getElementById('zoomInBtn').addEventListener('click', () => {
            this.viewer.zoomIn();
            this.updateZoomLevel();
        });

        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            this.viewer.zoomOut();
            this.updateZoomLevel();
        });

        document.getElementById('resetViewBtn').addEventListener('click', () => {
            this.viewer.resetView();
            this.updateZoomLevel();
        });

        // Track visibility controls
        document.getElementById('showAllTracksBtn').addEventListener('click', () => {
            this.viewer.showAllTracks();
        });

        document.getElementById('hideAllTracksBtn').addEventListener('click', () => {
            this.viewer.hideAllTracks();
        });

        // Selection controls
        document.getElementById('clearSelectionBtn').addEventListener('click', () => {
            this.viewer.clearSelection();
        });

        document.getElementById('exportLLMBtn').addEventListener('click', () => {
            this.showBottomPanel('llm');
        });

        // Bottom panel toggle
        document.getElementById('bottomPanelToggle').addEventListener('click', () => {
            this.toggleBottomPanel();
        });

        document.getElementById('bottomPanelHeader').addEventListener('dblclick', () => {
            this.toggleBottomPanel();
        });

        // Bottom panel resize
        this.setupBottomPanelResize();

        // Bottom panel tabs
        document.querySelectorAll('.bottom-panel-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = tab.dataset.tab;
                this.switchBottomTab(tabName);
            });
        });

        // LLM panel controls
        document.getElementById('copyLLMBtn').addEventListener('click', () => {
            this.copyLLMOutput();
        });

        document.getElementById('exportFormat').addEventListener('change', () => {
            this.updateLLMOutput();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + C to copy when on LLM tab
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                const llmTab = document.getElementById('llmTab');
                if (llmTab.classList.contains('active')) {
                    e.preventDefault();
                    this.copyLLMOutput();
                }
            }
            
            // Escape to collapse bottom panel
            if (e.key === 'Escape') {
                this.collapseBottomPanel();
            }
        });
    }

    /**
     * Load a trace file
     */
    async loadTraceFile(file) {
        this.updateStatus(`Loading ${file.name}...`, 'loading');

        try {
            this.traceData = await this.parser.parseFile(file);
            this.viewer.loadTrace(this.traceData);
            
            const sliceCount = this.traceData.slices.length;
            const trackCount = this.traceData.tracks.length;
            const duration = TraceParser.formatDuration(this.traceData.timeRange.end - this.traceData.timeRange.start);
            
            this.updateStatus(`Loaded: ${sliceCount} slices across ${trackCount} tracks (${duration})`);
            this.updateZoomLevel();
        } catch (error) {
            console.error('Error loading trace:', error);
            this.updateStatus(`Error loading trace: ${error.message}`, 'error');
        }
    }

    /**
     * Load demo trace
     */
    loadDemoTrace() {
        this.updateStatus('Loading demo trace...', 'loading');

        // Create demo trace
        this.traceData = this.parser.createDemoTrace();
        this.viewer.loadTrace(this.traceData);

        const sliceCount = this.traceData.slices.length;
        const trackCount = this.traceData.tracks.length;
        const duration = TraceParser.formatDuration(this.traceData.timeRange.end - this.traceData.timeRange.start);

        this.updateStatus(`Demo loaded: ${sliceCount} slices across ${trackCount} tracks (${duration})`);
        this.updateZoomLevel();
    }

    /**
     * Handle slice click
     */
    handleSliceClick(slice) {
        this.showSliceDetails(slice);
    }

    /**
     * Handle slice hover
     */
    handleSliceHover(slice, x, y) {
        const tooltip = document.getElementById('hoverTooltip');

        if (slice) {
            const track = this.parser.getTrackById(slice.trackId);
            
            tooltip.innerHTML = `
                <div class="tooltip-title">${slice.name}</div>
                <div class="tooltip-details">
                    <div>Duration: ${TraceParser.formatDuration(slice.duration)}</div>
                    <div>Start: ${TraceParser.formatTimestamp(slice.startTime)}</div>
                    <div>Track: ${track ? track.name : 'Unknown'}</div>
                    ${slice.category ? `<div>Category: ${slice.category}</div>` : ''}
                </div>
            `;

            // Position tooltip
            const containerRect = document.getElementById('canvasContainer').getBoundingClientRect();
            let left = x - containerRect.left + 10;
            let top = y - containerRect.top + 10;

            // Keep tooltip in view
            if (left + 300 > containerRect.width) {
                left = x - containerRect.left - 310;
            }
            if (top + 100 > containerRect.height) {
                top = y - containerRect.top - 110;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.style.display = 'block';
        } else {
            tooltip.style.display = 'none';
        }
    }

    /**
     * Handle selection change
     */
    handleSelectionChange(slices) {
        this.selectedSlices = slices;
        
        // Update status bar
        const selectionInfo = document.getElementById('selectionInfo');
        if (slices.length > 0) {
            const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
            selectionInfo.textContent = `${slices.length} slice(s) selected (${TraceParser.formatDuration(totalDuration)} total)`;
        } else {
            selectionInfo.textContent = '';
        }

        // Update selection count in bottom panel
        const selectionCount = document.getElementById('selectionCount');
        if (slices.length > 0) {
            selectionCount.textContent = `${slices.length} selected`;
            selectionCount.style.display = 'inline-block';
        } else {
            selectionCount.textContent = '';
            selectionCount.style.display = 'none';
        }

        // Update bottom panel details
        this.updateSliceDetailsGrid(slices);

        // Update LLM output
        this.updateLLMOutput();

        // Expand bottom panel if we have selections
        if (slices.length > 0) {
            this.expandBottomPanel();
        }
    }

    /**
     * Handle view change
     */
    handleViewChange(viewStart, viewEnd) {
        const viewRange = document.getElementById('viewRange');
        viewRange.textContent = `View: ${TraceParser.formatTimestamp(viewStart)} - ${TraceParser.formatTimestamp(viewEnd)}`;
        this.updateZoomLevel();
    }

    /**
     * Handle mode change from viewer
     */
    handleModeChange(mode) {
        this.currentMode = mode;
        this.updateModeButtons();
    }

    /**
     * Handle track visibility change - update LLM output without clearing selection
     */
    handleTrackVisibilityChange(trackId, isVisible) {
        // Update LLM output to reflect hidden/shown tracks
        this.updateLLMOutput();
    }

    /**
     * Set interaction mode
     */
    setMode(mode) {
        this.currentMode = mode;
        this.viewer.setMode(mode);
        this.updateModeButtons();
    }

    /**
     * Update mode toggle buttons
     */
    updateModeButtons() {
        const panBtn = document.getElementById('panModeBtn');
        const selectBtn = document.getElementById('selectModeBtn');
        
        panBtn.classList.toggle('active', this.currentMode === 'pan');
        selectBtn.classList.toggle('active', this.currentMode === 'select');
    }

    /**
     * Show slice details (clicking on a single slice)
     */
    showSliceDetails(slice) {
        // Add to selection and show in bottom panel
        this.selectedSlices = [slice];
        this.updateSliceDetailsGrid([slice]);
        this.updateLLMOutput();
        this.showBottomPanel('details');
        
        // Update selection count
        const selectionCount = document.getElementById('selectionCount');
        selectionCount.textContent = '1 selected';
        selectionCount.style.display = 'inline-block';
    }

    /**
     * Update the slice details grid in bottom panel
     */
    updateSliceDetailsGrid(slices) {
        const grid = document.getElementById('sliceDetailsGrid');
        
        if (slices.length === 0) {
            grid.innerHTML = '<p class="placeholder">Click on a slice to see details</p>';
            return;
        }

        // Single slice - show detailed card
        if (slices.length === 1) {
            const slice = slices[0];
            const track = this.parser.getTrackById(slice.trackId);
            grid.innerHTML = `
                <div class="detail-card single-slice">
                    <div class="detail-card-header">
                        <span class="detail-card-title">${slice.name}</span>
                        <span class="detail-card-duration">${TraceParser.formatDuration(slice.duration)}</span>
                    </div>
                    <div class="detail-card-body">
                        <div class="detail-row">
                            <label>Start</label>
                            <span class="value">${TraceParser.formatTimestamp(slice.startTime)}</span>
                        </div>
                        <div class="detail-row">
                            <label>End</label>
                            <span class="value">${TraceParser.formatTimestamp(slice.endTime)}</span>
                        </div>
                        <div class="detail-row">
                            <label>Track</label>
                            <span class="value">${track ? track.name : 'Unknown'}</span>
                        </div>
                        <div class="detail-row">
                            <label>Process</label>
                            <span class="value">${track ? track.processName : 'Unknown'}</span>
                        </div>
                        ${slice.category ? `
                        <div class="detail-row">
                            <label>Category</label>
                            <span class="value">${slice.category}</span>
                        </div>
                        ` : ''}
                        ${slice.args && Object.keys(slice.args).length > 0 ? `
                        <div class="detail-row args">
                            <label>Arguments</label>
                            <pre class="value">${JSON.stringify(slice.args, null, 2)}</pre>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
            return;
        }

        // Multiple slices - show accumulated summary
        // Use loop instead of spread to avoid stack overflow with large arrays
        let totalDuration = 0;
        let minStart = Infinity;
        let maxEnd = -Infinity;
        let minDuration = Infinity;
        let maxDuration = -Infinity;
        for (const s of slices) {
            totalDuration += s.duration;
            if (s.startTime < minStart) minStart = s.startTime;
            if (s.endTime > maxEnd) maxEnd = s.endTime;
            if (s.duration < minDuration) minDuration = s.duration;
            if (s.duration > maxDuration) maxDuration = s.duration;
        }
        const timeSpan = maxEnd - minStart;
        const avgDuration = totalDuration / slices.length;
        
        // Group by name
        const byName = {};
        slices.forEach(s => {
            if (!byName[s.name]) {
                byName[s.name] = { count: 0, totalDuration: 0, minDur: Infinity, maxDur: 0 };
            }
            byName[s.name].count++;
            byName[s.name].totalDuration += s.duration;
            byName[s.name].minDur = Math.min(byName[s.name].minDur, s.duration);
            byName[s.name].maxDur = Math.max(byName[s.name].maxDur, s.duration);
        });
        
        // Sort by total duration
        const namesSorted = Object.entries(byName)
            .sort((a, b) => b[1].totalDuration - a[1].totalDuration);
        
        // Group by track
        const byTrack = {};
        slices.forEach(s => {
            const track = this.parser.getTrackById(s.trackId);
            const trackName = track ? track.name : 'Unknown';
            if (!byTrack[trackName]) {
                byTrack[trackName] = { count: 0, totalDuration: 0 };
            }
            byTrack[trackName].count++;
            byTrack[trackName].totalDuration += s.duration;
        });
        
        const tracksSorted = Object.entries(byTrack)
            .sort((a, b) => b[1].totalDuration - a[1].totalDuration);

        grid.innerHTML = `
            <div class="summary-container">
                <!-- Summary Stats Table -->
                <div class="summary-table-section">
                    <h4>Selection Summary</h4>
                    <table class="summary-table">
                        <tbody>
                            <tr>
                                <td class="label">Total Slices</td>
                                <td class="value">${slices.length}</td>
                                <td class="label">Time Span</td>
                                <td class="value">${TraceParser.formatDuration(timeSpan)}</td>
                            </tr>
                            <tr>
                                <td class="label">Total Duration</td>
                                <td class="value">${TraceParser.formatDuration(totalDuration)}</td>
                                <td class="label">Avg Duration</td>
                                <td class="value">${TraceParser.formatDuration(avgDuration)}</td>
                            </tr>
                            <tr>
                                <td class="label">Min Duration</td>
                                <td class="value">${TraceParser.formatDuration(minDuration)}</td>
                                <td class="label">Max Duration</td>
                                <td class="value">${TraceParser.formatDuration(maxDuration)}</td>
                            </tr>
                            <tr>
                                <td class="label">Start Time</td>
                                <td class="value">${TraceParser.formatTimestamp(minStart)}</td>
                                <td class="label">End Time</td>
                                <td class="value">${TraceParser.formatTimestamp(maxEnd)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- By Name Table -->
                <div class="summary-table-section">
                    <h4>By Slice Name <span class="table-count">(${namesSorted.length} unique)</span></h4>
                    <div class="table-scroll">
                        <table class="breakdown-table">
                            <thead>
                                <tr>
                                    <th class="col-name">Name</th>
                                    <th class="col-count">Count</th>
                                    <th class="col-total">Total</th>
                                    <th class="col-avg">Avg</th>
                                    <th class="col-range">Min / Max</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${namesSorted.slice(0, 15).map(([name, data]) => `
                                    <tr>
                                        <td class="col-name" title="${name}">${name}</td>
                                        <td class="col-count">${data.count}</td>
                                        <td class="col-total">${TraceParser.formatDuration(data.totalDuration)}</td>
                                        <td class="col-avg">${TraceParser.formatDuration(data.totalDuration / data.count)}</td>
                                        <td class="col-range">${TraceParser.formatDuration(data.minDur)} / ${TraceParser.formatDuration(data.maxDur)}</td>
                                    </tr>
                                `).join('')}
                                ${namesSorted.length > 15 ? `
                                    <tr class="more-row">
                                        <td colspan="5">+ ${namesSorted.length - 15} more slices...</td>
                                    </tr>
                                ` : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- By Track Table -->
                <div class="summary-table-section">
                    <h4>By Track <span class="table-count">(${tracksSorted.length} tracks)</span></h4>
                    <div class="table-scroll">
                        <table class="breakdown-table">
                            <thead>
                                <tr>
                                    <th class="col-name">Track</th>
                                    <th class="col-count">Count</th>
                                    <th class="col-total">Total Duration</th>
                                    <th class="col-pct">% of Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tracksSorted.map(([name, data]) => `
                                    <tr>
                                        <td class="col-name" title="${name}">${name}</td>
                                        <td class="col-count">${data.count}</td>
                                        <td class="col-total">${TraceParser.formatDuration(data.totalDuration)}</td>
                                        <td class="col-pct">${((data.totalDuration / totalDuration) * 100).toFixed(1)}%</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Toggle bottom panel collapsed state
     */
    toggleBottomPanel() {
        const panel = document.getElementById('bottomPanel');
        panel.classList.toggle('collapsed');
    }

    /**
     * Expand bottom panel
     */
    expandBottomPanel() {
        const panel = document.getElementById('bottomPanel');
        panel.classList.remove('collapsed');
    }

    /**
     * Collapse bottom panel
     */
    collapseBottomPanel() {
        const panel = document.getElementById('bottomPanel');
        panel.classList.add('collapsed');
    }

    /**
     * Setup bottom panel resize functionality
     */
    setupBottomPanelResize() {
        const panel = document.getElementById('bottomPanel');
        const handle = document.getElementById('bottomPanelResizeHandle');
        
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = panel.offsetHeight;
            panel.classList.add('resizing');
            handle.classList.add('active');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaY = startY - e.clientY;
            const newHeight = Math.max(100, Math.min(window.innerHeight * 0.7, startHeight + deltaY));
            panel.style.height = newHeight + 'px';
            
            // Trigger canvas resize
            if (this.viewer) {
                this.viewer.setupCanvas();
                this.viewer.render();
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                panel.classList.remove('resizing');
                handle.classList.remove('active');
                
                // Final canvas resize
                if (this.viewer) {
                    this.viewer.setupCanvas();
                    this.viewer.render();
                }
            }
        });
    }

    /**
     * Show bottom panel and switch to a specific tab
     */
    showBottomPanel(tabName) {
        this.expandBottomPanel();
        this.switchBottomTab(tabName);
    }

    /**
     * Switch between tabs in bottom panel
     */
    switchBottomTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.bottom-panel-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.bottom-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabName + 'Tab');
        });

        // Refresh LLM output when switching to LLM tab
        if (tabName === 'llm') {
            this.updateLLMOutput();
        }
    }

    /**
     * Update LLM output based on selection (excludes hidden tracks)
     */
    updateLLMOutput() {
        const format = document.getElementById('exportFormat').value;
        const output = document.getElementById('llmOutput');
        
        // Use getSelectedSlicesForExport to exclude hidden tracks
        const slices = this.viewer.getSelectedSlicesForExport();

        const viewInfo = {
            viewStart: this.viewer.viewStart,
            viewEnd: this.viewer.viewEnd,
            zoom: this.viewer.zoom
        };

        output.value = this.exporter.export(
            slices, 
            this.traceData ? this.traceData.tracks : [], 
            format,
            viewInfo
        );
    }

    /**
     * Export a single slice
     */
    exportSingleSlice(sliceId) {
        const slice = this.parser.getSliceById(sliceId);
        if (slice) {
            this.selectedSlices = [slice];
            this.showBottomPanel('llm');
        }
    }

    /**
     * Copy LLM output to clipboard
     */
    async copyLLMOutput() {
        const output = document.getElementById('llmOutput');
        const success = await this.exporter.copyToClipboard(output.value);

        if (success) {
            this.showCopyNotification('Copied to clipboard!');
        } else {
            this.showCopyNotification('Failed to copy', true);
        }
    }

    /**
     * Show copy notification
     */
    showCopyNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = 'copy-success';
        notification.textContent = message;
        
        if (isError) {
            notification.style.background = '#f44336';
        }
        
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 2000);
    }

    /**
     * Update zoom level display
     */
    updateZoomLevel() {
        if (this.viewer) {
            document.getElementById('zoomLevel').textContent = `${this.viewer.getZoomLevel()}%`;
        }
    }

    /**
     * Update status message
     */
    updateStatus(message, type = 'info') {
        const status = document.getElementById('statusMessage');
        status.textContent = message;
        status.className = type === 'loading' ? 'loading' : '';
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});

// Make app available globally for onclick handlers
window.app = app;
