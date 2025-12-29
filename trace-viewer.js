/**
 * Trace Viewer
 * Canvas-based visualization with zoom, pan, and selection capabilities
 */

// Polyfill for roundRect if not supported
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}

class TraceViewer {
    constructor(canvasContainer, trackLabelsContainer, rulerCanvas) {
        this.canvasContainer = canvasContainer;
        this.canvas = document.getElementById('traceCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.trackLabelsContainer = trackLabelsContainer;
        this.rulerCanvas = rulerCanvas;
        this.rulerCtx = rulerCanvas.getContext('2d');

        // Data
        this.tracks = [];
        this.slices = [];
        this.timeRange = { start: 0, end: 1000000 };

        // View state
        this.viewStart = 0;
        this.viewEnd = 1000000;
        this.zoom = 1;
        this.trackHeight = 40;
        this.sliceHeight = 24;
        this.trackPadding = 8;

        // Interaction mode: 'pan' or 'select' - default to select
        this.interactionMode = 'select';

        // Interaction state
        this.isDragging = false;
        this.isPanning = false;
        this.isSelecting = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.panStartView = 0;
        this.selectionStart = { x: 0, y: 0 };
        this.selectionEnd = { x: 0, y: 0 };

        // Selection
        this.selectedSlices = new Set();
        this.hoveredSlice = null;
        this.clickedSlice = null;

        // Hidden tracks
        this.hiddenTracks = new Set();

        // Colors
        this.sliceColors = [
            '#4285f4', '#ea4335', '#fbbc04', '#34a853',
            '#ff6d01', '#46bdc6', '#7baaf7', '#f07b72'
        ];
        this.bgColor = '#1a1a2e';
        this.gridColor = '#2a2a4a';
        this.textColor = '#eee';
        this.selectionColor = 'rgba(233, 69, 96, 0.3)';

        // Callbacks
        this.onSliceClick = null;
        this.onSliceHover = null;
        this.onSelectionChange = null;
        this.onViewChange = null;
        this.onModeChange = null;

        // Initialize
        this.dpr = window.devicePixelRatio || 1;
        this.setupCanvas();
        this.setupEventListeners();
    }

    /**
     * Setup canvas dimensions
     */
    setupCanvas() {
        const rect = this.canvasContainer.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;

        // Set canvas size accounting for device pixel ratio
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        
        // Reset transform and apply scale
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(this.dpr, this.dpr);

        this.width = rect.width;
        this.height = rect.height;

        // Setup ruler canvas
        const rulerRect = this.rulerCanvas.parentElement.getBoundingClientRect();
        this.rulerCanvas.width = rulerRect.width * this.dpr;
        this.rulerCanvas.height = rulerRect.height * this.dpr;
        this.rulerCanvas.style.width = `${rulerRect.width}px`;
        this.rulerCanvas.style.height = `${rulerRect.height}px`;
        
        // Reset transform and apply scale
        this.rulerCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.rulerCtx.scale(this.dpr, this.dpr);

        this.rulerWidth = rulerRect.width;
        this.rulerHeight = rulerRect.height;
    }

    /**
     * Get mouse coordinates relative to canvas (accounting for CSS sizing)
     */
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));

        // Keyboard events
        document.addEventListener('keydown', this.handleKeyDown.bind(this));

        // Resize
        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.render();
        });
    }

    /**
     * Load trace data
     */
    loadTrace(data) {
        this.tracks = data.tracks || [];
        this.slices = data.slices || [];
        this.timeRange = data.timeRange || { start: 0, end: 1000000 };

        // Reset view
        this.viewStart = this.timeRange.start;
        this.viewEnd = this.timeRange.end;
        this.zoom = 1;

        // Calculate total height
        this.totalHeight = this.tracks.reduce((sum, track) => {
            return sum + (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;
        }, 0);

        // Clear selection
        this.selectedSlices.clear();
        this.hoveredSlice = null;
        this.clickedSlice = null;
        
        // Clear hidden tracks
        this.hiddenTracks.clear();

        // Render track labels
        this.renderTrackLabels();

        // Render
        this.render();
    }

    /**
     * Render track labels with visibility toggles
     */
    renderTrackLabels() {
        this.trackLabelsContainer.innerHTML = '';
        
        this.tracks.forEach(track => {
            const isHidden = this.hiddenTracks.has(track.id);
            const trackHeight = isHidden ? 28 : (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;
            
            const label = document.createElement('div');
            label.className = `track-label ${isHidden ? 'hidden-track' : ''}`;
            label.style.height = `${trackHeight}px`;
            label.dataset.trackId = track.id;
            
            label.innerHTML = `
                <button class="track-visibility-btn" data-track-id="${track.id}" title="${isHidden ? 'Show track' : 'Hide track'}">
                    ${isHidden ? '👁️‍🗨️' : '👁️'}
                </button>
                <div class="track-info">
                    <div class="track-name">${track.name}</div>
                    <div class="track-process">${track.processName} ${isHidden ? '(hidden)' : `(${track.slices.length} slices)`}</div>
                </div>
            `;
            
            // Add click handler for visibility toggle
            const visBtn = label.querySelector('.track-visibility-btn');
            visBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTrackVisibility(track.id);
            });
            
            this.trackLabelsContainer.appendChild(label);
        });
    }

    /**
     * Toggle track visibility
     */
    toggleTrackVisibility(trackId) {
        if (this.hiddenTracks.has(trackId)) {
            this.hiddenTracks.delete(trackId);
        } else {
            this.hiddenTracks.add(trackId);
        }
        
        // Re-render track labels and canvas
        this.renderTrackLabels();
        this.render();
        
        // Notify about track visibility change (for LLM output update)
        if (this.onTrackVisibilityChange) {
            this.onTrackVisibilityChange(trackId, !this.hiddenTracks.has(trackId));
        }
    }

    /**
     * Hide all tracks
     */
    hideAllTracks() {
        this.tracks.forEach(track => this.hiddenTracks.add(track.id));
        this.renderTrackLabels();
        this.render();
        
        // Notify about track visibility change
        if (this.onTrackVisibilityChange) {
            this.onTrackVisibilityChange(null, false);
        }
    }

    /**
     * Show all tracks
     */
    showAllTracks() {
        this.hiddenTracks.clear();
        this.renderTrackLabels();
        this.render();
        
        // Notify about track visibility change
        if (this.onTrackVisibilityChange) {
            this.onTrackVisibilityChange(null, true);
        }
    }

    /**
     * Get visible tracks
     */
    getVisibleTracks() {
        return this.tracks.filter(track => !this.hiddenTracks.has(track.id));
    }

    /**
     * Main render function
     */
    render() {
        // Clear canvas
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Draw grid
        this.drawGrid();

        // Draw slices (optimized)
        this.drawSlicesOptimized();

        // Update time ruler (always visible)
        this.updateTimeRuler();

        // Draw selection time markers (vertical lines only)
        if (this.selectedSlices.size > 0) {
            this.drawSelectionMarkers();
            this.updateSelectionTimeBar();
        } else {
            this.hideSelectionTimeBar();
        }

        // Draw selection overlay
        if (this.isSelecting) {
            this.drawSelectionOverlay();
        }

        // Draw ruler
        this.drawRuler();

        // Notify view change
        if (this.onViewChange) {
            this.onViewChange(this.viewStart, this.viewEnd);
        }
    }

    /**
     * Draw vertical time markers for selected slices on the canvas
     */
    drawSelectionMarkers() {
        const selectedSliceArray = this.slices.filter(s => this.selectedSlices.has(s.id));
        if (selectedSliceArray.length === 0) return;

        // Find min start and max end of selection
        const minStart = Math.min(...selectedSliceArray.map(s => s.startTime));
        const maxEnd = Math.max(...selectedSliceArray.map(s => s.endTime));
        
        const x1 = this.timeToX(minStart);
        const x2 = this.timeToX(maxEnd);
        
        const markerColor = '#4FC3F7'; // Light blue
        
        this.ctx.save();
        
        // Draw vertical dashed lines
        this.ctx.strokeStyle = markerColor;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 4]);
        
        // Start marker
        if (x1 >= 0 && x1 <= this.width) {
            this.ctx.beginPath();
            this.ctx.moveTo(x1, 0);
            this.ctx.lineTo(x1, this.height);
            this.ctx.stroke();
        }
        
        // End marker
        if (x2 >= 0 && x2 <= this.width) {
            this.ctx.beginPath();
            this.ctx.moveTo(x2, 0);
            this.ctx.lineTo(x2, this.height);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }

    /**
     * Update the selection time bar (HTML element above canvas)
     */
    updateSelectionTimeBar() {
        const content = document.getElementById('timeBarContent');
        
        if (!content) return;

        const selectedSliceArray = this.slices.filter(s => this.selectedSlices.has(s.id));
        if (selectedSliceArray.length === 0) {
            content.innerHTML = '';
            return;
        }

        // Find min start and max end of selection
        const minStart = Math.min(...selectedSliceArray.map(s => s.startTime));
        const maxEnd = Math.max(...selectedSliceArray.map(s => s.endTime));
        const timeDelta = maxEnd - minStart;
        
        const x1 = this.timeToX(minStart);
        const x2 = this.timeToX(maxEnd);
        
        // Calculate positions as percentages
        const x1Pct = (x1 / this.width) * 100;
        const x2Pct = (x2 / this.width) * 100;
        const centerPct = (x1Pct + x2Pct) / 2;
        
        const startTimeText = TraceParser.formatTimestamp(minStart);
        const endTimeText = TraceParser.formatTimestamp(maxEnd);
        const deltaText = TraceParser.formatDuration(timeDelta);

        // Build the time bar HTML
        let html = '';
        
        // Start marker
        if (x1 >= -10 && x1 <= this.width + 10) {
            html += `<div class="time-marker start" style="left: ${Math.max(0, x1Pct)}%;" data-time="${startTimeText}"></div>`;
        }
        
        // End marker  
        if (x2 >= -10 && x2 <= this.width + 10) {
            html += `<div class="time-marker end" style="left: ${Math.min(100, x2Pct)}%;" data-time="${endTimeText}"></div>`;
        }
        
        // Connecting line and badge
        if (x1 <= this.width && x2 >= 0) {
            const lineLeft = Math.max(0, x1Pct);
            const lineRight = Math.min(100, x2Pct);
            const lineWidth = lineRight - lineLeft;
            
            if (lineWidth > 0) {
                html += `<div class="time-delta-line" style="left: ${lineLeft}%; width: ${lineWidth}%;"></div>`;
            }
            
            // Badge
            const badgeCenterPct = Math.max(10, Math.min(90, centerPct));
            html += `<div class="time-delta-badge" style="left: ${badgeCenterPct}%;">${deltaText}</div>`;
            
            // Arrows
            if (x1 >= 0 && x1 <= this.width) {
                html += `<div class="time-delta-arrows left" style="left: ${x1Pct}%;"></div>`;
            }
            if (x2 >= 0 && x2 <= this.width) {
                html += `<div class="time-delta-arrows right" style="left: calc(${x2Pct}% - 6px);"></div>`;
            }
        }

        content.innerHTML = html;
    }

    /**
     * Hide the selection time bar content
     */
    hideSelectionTimeBar() {
        const content = document.getElementById('timeBarContent');
        if (content) {
            content.innerHTML = '';
        }
    }

    /**
     * Update the time ruler with tick marks and labels
     */
    updateTimeRuler() {
        const ruler = document.getElementById('timeRuler');
        if (!ruler) return;

        const viewDuration = this.viewEnd - this.viewStart;
        
        // Calculate appropriate interval for major ticks (aim for ~8-12 major ticks)
        const targetMajorTicks = 10;
        const rawInterval = viewDuration / targetMajorTicks;
        
        // Round to nice numbers: 1, 2, 5, 10, 20, 50, 100, 200, 500, etc.
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
        const normalized = rawInterval / magnitude;
        let niceInterval;
        if (normalized <= 1) niceInterval = 1;
        else if (normalized <= 2) niceInterval = 2;
        else if (normalized <= 5) niceInterval = 5;
        else niceInterval = 10;
        
        const majorInterval = niceInterval * magnitude;
        const minorInterval = majorInterval / 5;
        
        // Find first major tick
        const firstMajorTick = Math.ceil(this.viewStart / majorInterval) * majorInterval;
        const firstMinorTick = Math.ceil(this.viewStart / minorInterval) * minorInterval;
        
        let html = '';
        
        // Draw minor ticks
        for (let t = firstMinorTick; t <= this.viewEnd; t += minorInterval) {
            // Skip if it's a major tick position
            if (Math.abs(t % majorInterval) < minorInterval * 0.1) continue;
            
            const x = this.timeToX(t);
            if (x >= 0 && x <= this.width) {
                const xPct = (x / this.width) * 100;
                html += `<div class="time-ruler-tick minor" style="left: ${xPct}%;"></div>`;
            }
        }
        
        // Draw major ticks with labels
        for (let t = firstMajorTick; t <= this.viewEnd; t += majorInterval) {
            const x = this.timeToX(t);
            if (x >= 0 && x <= this.width) {
                const xPct = (x / this.width) * 100;
                const label = this.formatRulerTime(t, majorInterval);
                html += `<div class="time-ruler-tick major" style="left: ${xPct}%;"></div>`;
                html += `<div class="time-ruler-label" style="left: ${xPct}%;">${label}</div>`;
            }
        }
        
        ruler.innerHTML = html;
    }

    /**
     * Format time for ruler labels
     */
    formatRulerTime(timeUs, interval) {
        // Show appropriate precision based on interval
        if (interval >= 1000000) {
            // Seconds
            return (timeUs / 1000000).toFixed(interval >= 10000000 ? 0 : 1) + 's';
        } else if (interval >= 1000) {
            // Milliseconds
            return (timeUs / 1000).toFixed(interval >= 10000 ? 0 : 1) + 'ms';
        } else {
            // Microseconds
            return timeUs.toFixed(0) + 'µs';
        }
    }

    /**
     * Draw time grid
     */
    drawGrid() {
        const viewDuration = this.viewEnd - this.viewStart;
        
        // Calculate grid interval
        const intervals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
        let gridInterval = intervals.find(i => viewDuration / i < 20) || 1000000;

        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 1;

        const startGrid = Math.floor(this.viewStart / gridInterval) * gridInterval;
        
        for (let t = startGrid; t <= this.viewEnd; t += gridInterval) {
            const x = this.timeToX(t);
            if (x >= 0 && x <= this.width) {
                this.ctx.beginPath();
                this.ctx.moveTo(x, 0);
                this.ctx.lineTo(x, this.height);
                this.ctx.stroke();
            }
        }

        // Draw track separators (only for visible tracks)
        let y = 0;
        for (const track of this.tracks) {
            if (this.hiddenTracks.has(track.id)) continue;
            
            const trackHeight = (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;
            y += trackHeight;
            
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }
    }

    /**
     * Find all slices that might be visible in the current view.
     * A slice is visible if: startTime < viewEnd AND endTime > viewStart
     * 
     * Since slices are sorted by startTime, we can binary search to find 
     * where to stop, but we need to scan from the beginning to catch
     * long-running parent slices that start early but extend into view.
     */
    findVisibleSlices(slices, viewStart, viewEnd) {
        if (slices.length === 0) return [];
        
        // Binary search to find the first slice that starts after viewEnd
        // We can stop there since all subsequent slices start even later
        let left = 0;
        let right = slices.length - 1;
        let lastPossibleIdx = slices.length;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (slices[mid].startTime > viewEnd) {
                lastPossibleIdx = mid;
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        
        // Now scan from 0 to lastPossibleIdx and include slices that overlap the view
        const visible = [];
        for (let i = 0; i < lastPossibleIdx; i++) {
            const slice = slices[i];
            // A slice is visible if it ends after viewStart (and starts before viewEnd, which is guaranteed by lastPossibleIdx)
            if (slice.endTime > viewStart) {
                visible.push(slice);
            }
        }
        
        return visible;
    }

    /**
     * Binary search to find first slice that starts at or after a given time.
     * Used for hit testing.
     */
    findFirstSliceStartingAfter(slices, time) {
        let left = 0;
        let right = slices.length - 1;
        let result = slices.length;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (slices[mid].startTime >= time) {
                result = mid;
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        
        return result;
    }

    /**
     * Draw all visible slices with optimizations
     */
    drawSlicesOptimized() {
        let trackY = 0;
        const minSliceWidth = 0.5; // Minimum pixel width to render

        for (const track of this.tracks) {
            // Skip hidden tracks
            if (this.hiddenTracks.has(track.id)) continue;
            
            const trackHeight = (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            // Skip if track is not in visible Y range
            if (trackY > this.height) break;
            if (trackY + trackHeight < 0) {
                trackY += trackHeight;
                continue;
            }

            // Get all visible slices (includes parent slices that start before view)
            const visibleSlices = this.findVisibleSlices(track.slices, this.viewStart, this.viewEnd);

            // Draw slices
            for (const slice of visibleSlices) {
                const x1 = this.timeToX(slice.startTime);
                const x2 = this.timeToX(slice.endTime);
                const width = x2 - x1;
                
                // Skip very small slices when zoomed out
                if (width < minSliceWidth) continue;
                
                this.drawSliceFast(slice, trackY, x1, width);
            }

            trackY += trackHeight;
        }
    }

    /**
     * Draw a single slice (optimized version)
     */
    drawSliceFast(slice, trackY, x1, width) {
        const y = trackY + this.trackPadding + slice.depth * this.sliceHeight;
        const height = this.sliceHeight - 2;
        const x2 = x1 + width;

        // Calculate visible portion of the slice
        // Slice might start before view (x1 < 0) or end after view (x2 > width)
        const visibleX1 = Math.max(0, x1);
        const visibleX2 = Math.min(this.width, x2);
        const visibleWidth = visibleX2 - visibleX1;
        
        // Skip if not visible
        if (visibleWidth <= 0) return;

        // Determine slice state
        const isSelected = this.selectedSlices.has(slice.id);
        const isHovered = this.hoveredSlice === slice;
        const isClicked = this.clickedSlice === slice;

        // Get base color
        const color = this.sliceColors[slice.color % this.sliceColors.length];
        
        // Set styles based on state
        if (isSelected) {
            this.ctx.fillStyle = this.lightenColor(color, 0.3);
            this.ctx.strokeStyle = '#e94560';
            this.ctx.lineWidth = 2;
        } else if (isHovered) {
            this.ctx.fillStyle = this.lightenColor(color, 0.2);
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
        } else if (isClicked) {
            this.ctx.fillStyle = this.lightenColor(color, 0.4);
            this.ctx.strokeStyle = '#e94560';
            this.ctx.lineWidth = 3;
        } else {
            this.ctx.fillStyle = color;
            this.ctx.strokeStyle = this.darkenColor(color, 0.3);
            this.ctx.lineWidth = 1;
        }

        // Determine if we should draw rounded corners
        // Only round corners that are actually visible
        const leftVisible = x1 >= 0;
        const rightVisible = x2 <= this.width;

        // Draw rectangle
        if (visibleWidth > 6) {
            const radius = 3;
            this.ctx.beginPath();
            
            // Custom rounded rect to only round visible corners
            const r = radius;
            const left = visibleX1;
            const right = visibleX2;
            const top = y;
            const bottom = y + height;
            
            this.ctx.moveTo(left + (leftVisible ? r : 0), top);
            this.ctx.lineTo(right - (rightVisible ? r : 0), top);
            if (rightVisible) {
                this.ctx.arcTo(right, top, right, top + r, r);
            } else {
                this.ctx.lineTo(right, top);
            }
            this.ctx.lineTo(right, bottom - (rightVisible ? r : 0));
            if (rightVisible) {
                this.ctx.arcTo(right, bottom, right - r, bottom, r);
            } else {
                this.ctx.lineTo(right, bottom);
            }
            this.ctx.lineTo(left + (leftVisible ? r : 0), bottom);
            if (leftVisible) {
                this.ctx.arcTo(left, bottom, left, bottom - r, r);
            } else {
                this.ctx.lineTo(left, bottom);
            }
            this.ctx.lineTo(left, top + (leftVisible ? r : 0));
            if (leftVisible) {
                this.ctx.arcTo(left, top, left + r, top, r);
            } else {
                this.ctx.lineTo(left, top);
            }
            this.ctx.closePath();
            
            this.ctx.fill();
            if (isSelected || isHovered || isClicked) {
                this.ctx.stroke();
            }
        } else {
            // Simple rectangle for small slices
            this.ctx.fillRect(visibleX1, y, visibleWidth, height);
        }

        // Draw slice name if wide enough
        if (visibleWidth > 40) {
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
            this.ctx.textBaseline = 'middle';
            
            const text = slice.name;
            const textPadding = 4;
            // Text should start at visible area + padding, not before 
            const textX = Math.max(textPadding, visibleX1 + textPadding);
            const maxTextWidth = visibleX2 - textX - textPadding;
            
            if (maxTextWidth > 20) {
                // Simple truncation without measuring each iteration
                const measuredWidth = this.ctx.measureText(text).width;
                if (measuredWidth <= maxTextWidth) {
                    this.ctx.fillText(text, textX, y + height / 2);
                } else {
                    // Estimate truncation point
                    const avgCharWidth = 7;
                    const maxChars = Math.floor(maxTextWidth / avgCharWidth);
                    if (maxChars > 2) {
                        const truncated = text.substring(0, maxChars - 1) + '…';
                        this.ctx.fillText(truncated, textX, y + height / 2);
                    }
                }
            }
        }
    }

    /**
     * Draw all visible slices (legacy - kept for reference)
     */
    drawSlices() {
        let trackY = 0;

        this.tracks.forEach(track => {
            if (this.hiddenTracks.has(track.id)) return;
            
            const trackHeight = (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            // Get visible slices for this track
            const visibleSlices = track.slices.filter(slice => 
                slice.endTime >= this.viewStart && slice.startTime <= this.viewEnd
            );

            visibleSlices.forEach(slice => {
                this.drawSlice(slice, trackY);
            });

            trackY += trackHeight;
        });
    }

    /**
     * Draw a single slice
     */
    drawSlice(slice, trackY) {
        const x1 = this.timeToX(slice.startTime);
        const x2 = this.timeToX(slice.endTime);
        const width = Math.max(x2 - x1, 1);
        const y = trackY + this.trackPadding + slice.depth * this.sliceHeight;
        const height = this.sliceHeight - 2;

        // Skip if completely outside view
        if (x2 < 0 || x1 > this.width) return;

        // Determine slice state
        const isSelected = this.selectedSlices.has(slice.id);
        const isHovered = this.hoveredSlice === slice;
        const isClicked = this.clickedSlice === slice;

        // Draw slice background
        let color = this.sliceColors[slice.color % this.sliceColors.length];
        
        if (isSelected) {
            this.ctx.fillStyle = this.lightenColor(color, 0.3);
            this.ctx.strokeStyle = '#e94560';
            this.ctx.lineWidth = 2;
        } else if (isHovered) {
            this.ctx.fillStyle = this.lightenColor(color, 0.2);
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
        } else if (isClicked) {
            this.ctx.fillStyle = this.lightenColor(color, 0.4);
            this.ctx.strokeStyle = '#e94560';
            this.ctx.lineWidth = 3;
        } else {
            this.ctx.fillStyle = color;
            this.ctx.strokeStyle = this.darkenColor(color, 0.3);
            this.ctx.lineWidth = 1;
        }

        // Draw rounded rectangle
        const radius = 3;
        this.ctx.beginPath();
        this.ctx.roundRect(x1, y, width, height, radius);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw slice name if wide enough
        if (width > 30) {
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
            this.ctx.textBaseline = 'middle';
            
            const text = slice.name;
            const textWidth = this.ctx.measureText(text).width;
            
            if (textWidth < width - 6) {
                this.ctx.fillText(text, x1 + 4, y + height / 2);
            } else {
                // Truncate text
                let truncated = text;
                while (this.ctx.measureText(truncated + '…').width > width - 6 && truncated.length > 0) {
                    truncated = truncated.slice(0, -1);
                }
                if (truncated.length > 0) {
                    this.ctx.fillText(truncated + '…', x1 + 4, y + height / 2);
                }
            }
        }
    }

    /**
     * Draw selection overlay
     */
    drawSelectionOverlay() {
        const x1 = Math.min(this.selectionStart.x, this.selectionEnd.x);
        const y1 = Math.min(this.selectionStart.y, this.selectionEnd.y);
        const x2 = Math.max(this.selectionStart.x, this.selectionEnd.x);
        const y2 = Math.max(this.selectionStart.y, this.selectionEnd.y);

        this.ctx.fillStyle = this.selectionColor;
        this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

        this.ctx.strokeStyle = '#e94560';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    /**
     * Draw timeline ruler
     */
    drawRuler() {
        this.rulerCtx.fillStyle = '#0f3460';
        this.rulerCtx.fillRect(0, 0, this.rulerWidth, this.rulerHeight);

        const viewDuration = this.viewEnd - this.viewStart;
        
        // Calculate grid interval
        const intervals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
        let gridInterval = intervals.find(i => viewDuration / i < 10) || 1000000;

        const startGrid = Math.floor(this.viewStart / gridInterval) * gridInterval;

        this.rulerCtx.strokeStyle = '#2a2a4a';
        this.rulerCtx.fillStyle = '#aaa';
        this.rulerCtx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        this.rulerCtx.textBaseline = 'top';

        for (let t = startGrid; t <= this.viewEnd; t += gridInterval) {
            const x = this.timeToX(t);
            if (x >= 0 && x <= this.rulerWidth) {
                // Draw tick
                this.rulerCtx.beginPath();
                this.rulerCtx.moveTo(x, 0);
                this.rulerCtx.lineTo(x, 8);
                this.rulerCtx.stroke();

                // Draw label
                const label = TraceParser.formatTimestamp(t);
                this.rulerCtx.fillText(label, x + 3, 10);
            }
        }
    }

    /**
     * Convert time to X coordinate
     */
    timeToX(time) {
        const viewDuration = this.viewEnd - this.viewStart;
        return ((time - this.viewStart) / viewDuration) * this.width;
    }

    /**
     * Convert X coordinate to time
     */
    xToTime(x) {
        const viewDuration = this.viewEnd - this.viewStart;
        return this.viewStart + (x / this.width) * viewDuration;
    }

    /**
     * Get slice at position (accounts for hidden tracks)
     */
    getSliceAtPosition(x, y) {
        let trackY = 0;

        for (const track of this.tracks) {
            // Skip hidden tracks
            if (this.hiddenTracks.has(track.id)) continue;
            
            const trackHeight = (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            if (y >= trackY && y < trackY + trackHeight) {
                // Check slices in this track
                const time = this.xToTime(x);
                
                // Find slices that could contain this time point
                // Since slices are sorted by startTime, find where we'd insert this time
                const insertIdx = this.findFirstSliceStartingAfter(track.slices, time);
                
                // Check slices before insertIdx (they start before or at our time)
                // and slices around insertIdx for any that contain our time point
                let foundSlice = null;
                let maxDepth = -1; // For z-order, prefer slices with higher depth (on top)
                
                // Scan backwards to find slices that started before and might still be running
                for (let i = insertIdx - 1; i >= 0; i--) {
                    const slice = track.slices[i];
                    
                    // If this slice ends before our time, all earlier slices will too
                    // (since they start even earlier and traces typically have similar durations)
                    // But parent slices can be very long, so we need to check more
                    if (slice.endTime < time) {
                        // Check if we've gone far enough back
                        // If we've found a slice already and this one is much earlier, stop
                        if (foundSlice && time - slice.startTime > 10 * (slice.endTime - slice.startTime)) {
                            break;
                        }
                        continue;
                    }
                    
                    if (time >= slice.startTime && time <= slice.endTime) {
                        const sliceY = trackY + this.trackPadding + slice.depth * this.sliceHeight;
                        
                        if (y >= sliceY && y < sliceY + this.sliceHeight - 2) {
                            // Prefer the topmost slice (highest depth)
                            if (slice.depth > maxDepth) {
                                maxDepth = slice.depth;
                                foundSlice = slice;
                            }
                        }
                    }
                }
                
                return foundSlice; // Found the track but no slice at this position
            }

            trackY += trackHeight;
        }

        return null;
    }

    /**
     * Get slices in selection rectangle (accounts for hidden tracks)
     */
    getSlicesInSelection() {
        const x1 = Math.min(this.selectionStart.x, this.selectionEnd.x);
        const y1 = Math.min(this.selectionStart.y, this.selectionEnd.y);
        const x2 = Math.max(this.selectionStart.x, this.selectionEnd.x);
        const y2 = Math.max(this.selectionStart.y, this.selectionEnd.y);

        const t1 = this.xToTime(x1);
        const t2 = this.xToTime(x2);

        const selected = [];
        let trackY = 0;

        for (const track of this.tracks) {
            const trackHeight = (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            // Check if selection overlaps with track
            // Skip hidden tracks
            if (this.hiddenTracks.has(track.id)) continue;
            
            if (y2 >= trackY && y1 < trackY + trackHeight) {
                // Get all slices that overlap the time range (including parent slices)
                const visibleSlices = this.findVisibleSlices(track.slices, t1, t2);
                
                for (const slice of visibleSlices) {
                    const sliceY = trackY + this.trackPadding + slice.depth * this.sliceHeight;
                    
                    // Check Y overlap
                    if (y2 >= sliceY && y1 < sliceY + this.sliceHeight - 2) {
                        selected.push(slice);
                    }
                }
            }

            trackY += trackHeight;
        }

        return selected;
    }

    // Event Handlers

    handleMouseDown(e) {
        const pos = this.getMousePos(e);
        const x = pos.x;
        const y = pos.y;

        this.dragStartX = x;
        this.dragStartY = y;

        // Check if clicking on a slice first (works in both modes)
        const slice = this.getSliceAtPosition(x, y);

        if (this.interactionMode === 'select' || e.shiftKey) {
            // Select mode: drag to select multiple slices
            if (slice && !e.shiftKey) {
                // Clicked directly on a slice - select it
                if (e.ctrlKey || e.metaKey) {
                    if (this.selectedSlices.has(slice.id)) {
                        this.selectedSlices.delete(slice.id);
                    } else {
                        this.selectedSlices.add(slice.id);
                    }
                } else {
                    this.selectedSlices.clear();
                    this.selectedSlices.add(slice.id);
                }
                
                this.clickedSlice = slice;
                
                if (this.onSliceClick) {
                    this.onSliceClick(slice);
                }
                
                if (this.onSelectionChange) {
                    this.onSelectionChange(this.getSelectedSlices());
                }
            } else {
                // Start box selection
                this.isSelecting = true;
                this.selectionStart = { x, y };
                this.selectionEnd = { x, y };
            }
        } else {
            // Pan mode
            if (slice) {
                // Toggle selection with Ctrl/Cmd
                if (e.ctrlKey || e.metaKey) {
                    if (this.selectedSlices.has(slice.id)) {
                        this.selectedSlices.delete(slice.id);
                    } else {
                        this.selectedSlices.add(slice.id);
                    }
                } else {
                    // Single selection
                    this.selectedSlices.clear();
                    this.selectedSlices.add(slice.id);
                }
                
                this.clickedSlice = slice;
                
                if (this.onSliceClick) {
                    this.onSliceClick(slice);
                }
                
                if (this.onSelectionChange) {
                    this.onSelectionChange(this.getSelectedSlices());
                }
            } else {
                // Start panning
                this.isPanning = true;
                this.panStartView = this.viewStart;
            }
        }

        this.render();
    }

    handleMouseMove(e) {
        const pos = this.getMousePos(e);
        const x = pos.x;
        const y = pos.y;

        if (this.isSelecting) {
            this.selectionEnd = { x, y };
            this.render();
        } else if (this.isPanning) {
            const dx = x - this.dragStartX;
            const viewDuration = this.viewEnd - this.viewStart;
            const timeDelta = (dx / this.width) * viewDuration;
            
            this.viewStart = this.panStartView - timeDelta;
            this.viewEnd = this.viewStart + viewDuration;
            
            // Clamp to bounds
            if (this.viewStart < this.timeRange.start) {
                this.viewStart = this.timeRange.start;
                this.viewEnd = this.viewStart + viewDuration;
            }
            if (this.viewEnd > this.timeRange.end) {
                this.viewEnd = this.timeRange.end;
                this.viewStart = this.viewEnd - viewDuration;
            }
            
            this.render();
        } else {
            // Hover detection
            const slice = this.getSliceAtPosition(x, y);
            
            if (slice !== this.hoveredSlice) {
                this.hoveredSlice = slice;
                this.render();
                
                if (this.onSliceHover) {
                    this.onSliceHover(slice, e.clientX, e.clientY);
                }
            }
        }
    }

    handleMouseUp(e) {
        if (this.isSelecting) {
            const selected = this.getSlicesInSelection();
            
            if (e.ctrlKey || e.metaKey) {
                selected.forEach(slice => this.selectedSlices.add(slice.id));
            } else {
                this.selectedSlices.clear();
                selected.forEach(slice => this.selectedSlices.add(slice.id));
            }
            
            this.isSelecting = false;
            
            if (this.onSelectionChange) {
                this.onSelectionChange(this.getSelectedSlices());
            }
        }

        this.isPanning = false;
        this.updateCursor();
        this.render();
    }

    handleMouseLeave(e) {
        this.hoveredSlice = null;
        this.isPanning = false;
        this.isSelecting = false;
        this.updateCursor();
        
        if (this.onSliceHover) {
            this.onSliceHover(null);
        }
        
        this.render();
    }

    handleWheel(e) {
        e.preventDefault();

        const pos = this.getMousePos(e);
        const viewDuration = this.viewEnd - this.viewStart;
        const traceDuration = this.timeRange.end - this.timeRange.start;

        // Horizontal scroll (deltaX) = Pan
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            // Pan based on horizontal scroll
            const panAmount = (e.deltaX / this.width) * viewDuration;
            
            this.viewStart += panAmount;
            this.viewEnd += panAmount;
            
            // Clamp to bounds
            if (this.viewStart < this.timeRange.start) {
                this.viewStart = this.timeRange.start;
                this.viewEnd = this.viewStart + viewDuration;
            }
            if (this.viewEnd > this.timeRange.end) {
                this.viewEnd = this.timeRange.end;
                this.viewStart = this.viewEnd - viewDuration;
            }
        } else {
            // Vertical scroll (deltaY) = Zoom
            const x = pos.x;
            const zoomPoint = this.xToTime(x);

            // Calculate zoom factor
            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
            
            const newDuration = viewDuration * zoomFactor;

            // Calculate new view range centered on mouse position
            const ratio = (zoomPoint - this.viewStart) / viewDuration;
            this.viewStart = zoomPoint - ratio * newDuration;
            this.viewEnd = this.viewStart + newDuration;

            // Clamp to bounds
            if (newDuration > traceDuration) {
                this.viewStart = this.timeRange.start;
                this.viewEnd = this.timeRange.end;
            } else {
                if (this.viewStart < this.timeRange.start) {
                    this.viewStart = this.timeRange.start;
                    this.viewEnd = this.viewStart + newDuration;
                }
                if (this.viewEnd > this.timeRange.end) {
                    this.viewEnd = this.timeRange.end;
                    this.viewStart = this.viewEnd - newDuration;
                }
            }

            // Update zoom level
            this.zoom = traceDuration / (this.viewEnd - this.viewStart);
        }

        this.render();
    }

    handleDoubleClick(e) {
        const pos = this.getMousePos(e);
        const x = pos.x;
        const y = pos.y;

        const slice = this.getSliceAtPosition(x, y);
        
        if (slice) {
            // Zoom to slice
            const padding = slice.duration * 0.2;
            this.viewStart = Math.max(this.timeRange.start, slice.startTime - padding);
            this.viewEnd = Math.min(this.timeRange.end, slice.endTime + padding);
            this.zoom = (this.timeRange.end - this.timeRange.start) / (this.viewEnd - this.viewStart);
            this.render();
        }
    }

    handleKeyDown(e) {
        // Don't handle shortcuts if typing in an input/textarea
        const isTyping = document.activeElement.tagName === 'INPUT' || 
                         document.activeElement.tagName === 'TEXTAREA';
        
        if (e.key === 'Escape') {
            // Escape clears selection and switches to select mode
            this.clearSelection();
            this.setMode('select');
        } else if (e.key === ' ' && !isTyping) {
            // Spacebar switches to pan mode
            e.preventDefault();
            this.setMode('pan');
        } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.selectAll();
        } else if ((e.key === 'p' || e.key === 'P') && !isTyping) {
            // P also switches to pan mode
            this.setMode('pan');
        } else if ((e.key === 's' || e.key === 'S') && !isTyping) {
            // S also switches to select mode
            this.setMode('select');
        }
    }

    // Public methods

    /**
     * Set interaction mode ('pan' or 'select')
     */
    setMode(mode) {
        if (mode !== 'pan' && mode !== 'select') return;
        
        this.interactionMode = mode;
        this.updateCursor();
        
        if (this.onModeChange) {
            this.onModeChange(mode);
        }
    }

    /**
     * Get current interaction mode
     */
    getMode() {
        return this.interactionMode;
    }

    /**
     * Update cursor based on current mode
     */
    updateCursor() {
        this.canvasContainer.classList.remove('pan-mode', 'select-mode');
        this.canvasContainer.classList.add(`${this.interactionMode}-mode`);
    }

    /**
     * Get all selected slices (including from hidden tracks)
     */
    getSelectedSlices() {
        return this.slices.filter(slice => this.selectedSlices.has(slice.id));
    }

    /**
     * Get selected slices for LLM export (excludes slices from hidden tracks)
     */
    getSelectedSlicesForExport() {
        return this.slices.filter(slice => 
            this.selectedSlices.has(slice.id) && !this.hiddenTracks.has(slice.trackId)
        );
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedSlices.clear();
        this.clickedSlice = null;
        
        if (this.onSelectionChange) {
            this.onSelectionChange([]);
        }
        
        this.render();
    }

    /**
     * Select all visible slices (excludes hidden tracks)
     */
    selectAll() {
        const visibleSlices = this.slices.filter(slice => 
            slice.endTime >= this.viewStart && 
            slice.startTime <= this.viewEnd &&
            !this.hiddenTracks.has(slice.trackId)
        );
        
        visibleSlices.forEach(slice => this.selectedSlices.add(slice.id));
        
        if (this.onSelectionChange) {
            this.onSelectionChange(this.getSelectedSlices());
        }
        
        this.render();
    }

    /**
     * Zoom in
     */
    zoomIn() {
        const center = (this.viewStart + this.viewEnd) / 2;
        const viewDuration = (this.viewEnd - this.viewStart) * 0.5;
        
        this.viewStart = center - viewDuration / 2;
        this.viewEnd = center + viewDuration / 2;
        this.zoom = (this.timeRange.end - this.timeRange.start) / (this.viewEnd - this.viewStart);
        
        this.render();
    }

    /**
     * Zoom out
     */
    zoomOut() {
        const center = (this.viewStart + this.viewEnd) / 2;
        const viewDuration = Math.min(
            (this.viewEnd - this.viewStart) * 2,
            this.timeRange.end - this.timeRange.start
        );
        
        this.viewStart = Math.max(this.timeRange.start, center - viewDuration / 2);
        this.viewEnd = Math.min(this.timeRange.end, center + viewDuration / 2);
        this.zoom = (this.timeRange.end - this.timeRange.start) / (this.viewEnd - this.viewStart);
        
        this.render();
    }

    /**
     * Reset view to show entire trace
     */
    resetView() {
        this.viewStart = this.timeRange.start;
        this.viewEnd = this.timeRange.end;
        this.zoom = 1;
        this.render();
    }

    /**
     * Get current zoom level as percentage
     */
    getZoomLevel() {
        return Math.round(this.zoom * 100);
    }

    // Utility methods

    lightenColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + 255 * amount);
        const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + 255 * amount);
        const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + 255 * amount);
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    darkenColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, parseInt(hex.substr(0, 2), 16) * (1 - amount));
        const g = Math.max(0, parseInt(hex.substr(2, 2), 16) * (1 - amount));
        const b = Math.max(0, parseInt(hex.substr(4, 2), 16) * (1 - amount));
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
}

// Export for use in other files
window.TraceViewer = TraceViewer;
