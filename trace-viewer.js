/**
 * Trace Viewer - Optimized
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
        this.ctx = this.canvas.getContext('2d', { alpha: false }); // Optimization: alpha false
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

        // Interaction mode: 'pan' or 'select'
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

        // Rendering State (Optimization)
        this.rafId = null;
        this.isDirty = false;

        // Colors
        this.baseSliceColors = [
            '#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d01', '#46bdc6', '#7baaf7', '#f07b72',
            '#ab47bc', '#00bcd4', '#cddc39', '#ffb300', '#8d6e63', '#5c6bc0', '#009688', '#c62828',
            '#7e57c2', '#388e3c', '#f06292', '#ffa726', '#00897b', '#d4e157', '#6d4c41', '#1976d2'
        ];
        
        // Cache for calculated colors
        this.colorCache = []; 
        this.preCalculateColors();

        this.bgColor = '#f7f8fa'; 
        this.gridColor = '#e3e6ed'; 
        this.textColor = '#222';
        this.selectionColor = 'rgba(33, 150, 243, 0.12)';

        // Callbacks
        this.onSliceClick = null;
        this.onSliceHover = null;
        this.onSelectionChange = null;
        this.onViewChange = null;
        this.onModeChange = null;

        // Initialize
        this.dpr = window.devicePixelRatio || 1;
        this.bgColor = '#f7f8fa'; 

        // Initialize
        this.dpr = window.devicePixelRatio || 1;
        this.setupCanvas();
        
        // ADD THIS: Immediately paint the background to hide the "alpha: false" black default
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.setupEventListeners();
    }

    /**
     * Pre-calculate color variations to avoid doing this per-slice per-frame
     */
    preCalculateColors() {
        this.colorCache = this.baseSliceColors.map(color => ({
            normal: color,
            hover: this.lightenColor(color, 0.2),
            selected: this.lightenColor(color, 0.3),
            clicked: this.lightenColor(color, 0.4),
            border: this.darkenColor(color, 0.3)
        }));
    }

    setupCanvas() {
        const rect = this.canvasContainer.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(this.dpr, this.dpr);

        this.width = rect.width;
        this.height = rect.height;

        const rulerRect = this.rulerCanvas.parentElement.getBoundingClientRect();
        this.rulerCanvas.width = rulerRect.width * this.dpr;
        this.rulerCanvas.height = rulerRect.height * this.dpr;
        this.rulerCanvas.style.width = `${rulerRect.width}px`;
        this.rulerCanvas.style.height = `${rulerRect.height}px`;
        
        this.rulerCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.rulerCtx.scale(this.dpr, this.dpr);

        this.rulerWidth = rulerRect.width;
        this.rulerHeight = rulerRect.height;
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.scheduleRender();
        });
    }

    loadTrace(data) {
        this.tracks = data.tracks || [];
        this.slices = data.slices || [];
        this.timeRange = data.timeRange || { start: 0, end: 1000000 };
        this.viewStart = this.timeRange.start;
        this.viewEnd = this.timeRange.end;
        this.zoom = 1;

        // 1. Sort slices by startTime
        // 2. Calculate max duration per track (Critical for optimization)
        this.tracks.forEach(track => {
            track.slices.sort((a, b) => a.startTime - b.startTime);
            
            let maxDur = 0;
            for (const s of track.slices) {
                const dur = s.endTime - s.startTime;
                if (dur > maxDur) maxDur = dur;
            }
            track.maxItemDuration = maxDur;
        });

        this.selectedSlices.clear();
        this.hoveredSlice = null;
        this.clickedSlice = null;
        this.hiddenTracks.clear();
        this.renderTrackLabels();
        this.scheduleRender();
    }

    renderTrackLabels() {
        // (Same as original implementation)
        this.trackLabelsContainer.innerHTML = '';
        this.tracks.forEach(track => {
            const isHidden = this.hiddenTracks.has(track.id);
            const trackHeight = isHidden ? 28 : (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;
            
            const label = document.createElement('div');
            label.className = `track-label ${isHidden ? 'hidden-track' : ''}`;
            label.style.height = `${trackHeight}px`;
            label.dataset.trackId = track.id;
            
            label.innerHTML = `
                <button class="track-visibility-btn" data-track-id="${track.id}">
                    <i class="fa-solid fa-eye${isHidden ? '-slash' : ''}" style="font-size: 12px; color: ${isHidden ? '#90A4AE' : '#1565c0'};"></i>
                </button>
                <div class="track-info">
                    <div class="track-name">${track.name}</div>
                    <div class="track-process">${track.processName} ${isHidden ? '(hidden)' : `(${track.slices.length} slices)`}</div>
                </div>
            `;
            
            label.querySelector('.track-visibility-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTrackVisibility(track.id);
            });
            this.trackLabelsContainer.appendChild(label);
        });
    }

    toggleTrackVisibility(trackId) {
        if (this.hiddenTracks.has(trackId)) {
            this.hiddenTracks.delete(trackId);
        } else {
            this.hiddenTracks.add(trackId);
        }
        this.renderTrackLabels();
        this.scheduleRender();
        if (this.onTrackVisibilityChange) this.onTrackVisibilityChange(trackId, !this.hiddenTracks.has(trackId));
    }

    /**
     * Optimization: Schedule render on next animation frame
     */
    scheduleRender() {
        if (!this.rafId) {
            this.rafId = requestAnimationFrame(() => {
                this.render();
                this.rafId = null;
            });
        }
    }

    render() {
        // Optimization: Don't render if dimensions are invalid
        if (this.width === 0 || this.height === 0) return;

        // Clear canvas
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.drawGrid();
        this.drawSlicesOptimized();
        this.updateTimeRuler();

        if (this.selectedSlices.size > 0) {
            this.drawSelectionMarkers();
            this.updateSelectionTimeBar();
        } else {
            this.hideSelectionTimeBar();
        }

        if (this.isSelecting) {
            this.drawSelectionOverlay();
        }

        this.drawRuler();

        if (this.onViewChange) {
            this.onViewChange(this.viewStart, this.viewEnd);
        }
    }

    drawSelectionMarkers() {
        // OPTIMIZED: Iterate the Set directly instead of filtering the main array
        if (this.selectedSlices.size === 0) return;

        let minStart = Infinity;
        let maxEnd = -Infinity;
        
        // Since selectedSlices now holds objects, we can iterate it directly
        // This is O(K) (number of selected items) instead of O(N) (total items)
        for (const s of this.getSelectedSlices()) {
            if (s.startTime < minStart) minStart = s.startTime;
            if (s.endTime > maxEnd) maxEnd = s.endTime;
        }
        
        const x1 = this.timeToX(minStart);
        const x2 = this.timeToX(maxEnd);
        
        this.ctx.save();
        this.ctx.strokeStyle = '#4FC3F7';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 4]);
        
        if (x1 >= 0 && x1 <= this.width) {
            this.ctx.beginPath();
            this.ctx.moveTo(x1, 0);
            this.ctx.lineTo(x1, this.height);
            this.ctx.stroke();
        }
        if (x2 >= 0 && x2 <= this.width) {
            this.ctx.beginPath();
            this.ctx.moveTo(x2, 0);
            this.ctx.lineTo(x2, this.height);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    updateSelectionTimeBar() {
        const content = document.getElementById('timeBarContent');
        if (!content) return;
        
        // OPTIMIZED: Early exit
        if (this.selectedSlices.size === 0) {
            content.innerHTML = '';
            return;
        }

        let minStart = Infinity;
        let maxEnd = -Infinity;
        
        // OPTIMIZED: Direct Set iteration
        for (const s of this.getSelectedSlices()) {
            if (s.startTime < minStart) minStart = s.startTime;
            if (s.endTime > maxEnd) maxEnd = s.endTime;
        }
        
        // ... (Keep the rest of the drawing logic exactly the same)
        const x1 = this.timeToX(minStart);
        const x2 = this.timeToX(maxEnd);
        const x1Pct = (x1 / this.width) * 100;
        const x2Pct = (x2 / this.width) * 100;
        const centerPct = (x1Pct + x2Pct) / 2;
        
        const startTimeText = (typeof TraceParser !== 'undefined') ? TraceParser.formatTimestamp(minStart) : minStart;
        const endTimeText = (typeof TraceParser !== 'undefined') ? TraceParser.formatTimestamp(maxEnd) : maxEnd;
        const deltaText = (typeof TraceParser !== 'undefined') ? TraceParser.formatDuration(maxEnd - minStart) : (maxEnd - minStart);

        let html = '';
        if (x1 >= -10 && x1 <= this.width + 10) html += `<div class="time-marker start" style="left: ${Math.max(0, x1Pct)}%;" data-time="${startTimeText}"></div>`;
        if (x2 >= -10 && x2 <= this.width + 10) html += `<div class="time-marker end" style="left: ${Math.min(100, x2Pct)}%;" data-time="${endTimeText}"></div>`;
        
        if (x1 <= this.width && x2 >= 0) {
            const lineLeft = Math.max(0, x1Pct);
            const lineRight = Math.min(100, x2Pct);
            if (lineRight - lineLeft > 0) html += `<div class="time-delta-line" style="left: ${lineLeft}%; width: ${lineRight - lineLeft}%;"></div>`;
            html += `<div class="time-delta-badge" style="left: ${Math.max(10, Math.min(90, centerPct))}%;">${deltaText}</div>`;
        }
        content.innerHTML = html;
    }

    hideSelectionTimeBar() {
        const content = document.getElementById('timeBarContent');
        if (content) content.innerHTML = '';
    }

    updateTimeRuler() {
        // (Kept same)
        const ruler = document.getElementById('timeRuler');
        if (!ruler) return;

        const viewDuration = this.viewEnd - this.viewStart;
        const targetMajorTicks = 10;
        const rawInterval = viewDuration / targetMajorTicks;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
        const normalized = rawInterval / magnitude;
        let niceInterval = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        
        const majorInterval = niceInterval * magnitude;
        const minorInterval = majorInterval / 5;
        const firstMinorTick = Math.ceil(this.viewStart / minorInterval) * minorInterval;
        
        let html = '';
        for (let t = firstMinorTick; t <= this.viewEnd; t += minorInterval) {
            if (Math.abs(t % majorInterval) < minorInterval * 0.1) {
                // Major tick
                const x = this.timeToX(t);
                if (x >= 0 && x <= this.width) {
                    const xPct = (x / this.width) * 100;
                    html += `<div class="time-ruler-tick major" style="left: ${xPct}%;"></div>`;
                    html += `<div class="time-ruler-label" style="left: ${xPct}%;">${this.formatRulerTime(t, majorInterval)}</div>`;
                }
            } else {
                // Minor tick
                const x = this.timeToX(t);
                if (x >= 0 && x <= this.width) {
                    html += `<div class="time-ruler-tick minor" style="left: ${(x / this.width) * 100}%;"></div>`;
                }
            }
        }
        ruler.innerHTML = html;
    }

    formatRulerTime(timeUs, interval) {
        if (interval >= 1000000) return (timeUs / 1000000).toFixed(interval >= 10000000 ? 0 : 1) + 's';
        if (interval >= 1000) return (timeUs / 1000).toFixed(interval >= 10000 ? 0 : 1) + 'ms';
        return timeUs.toFixed(0) + 'µs';
    }

    drawGrid() {
        const viewDuration = this.viewEnd - this.viewStart;
        const intervals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
        let gridInterval = intervals.find(i => viewDuration / i < 20) || 1000000;

        this.ctx.beginPath();
        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 1;

        const startGrid = Math.floor(this.viewStart / gridInterval) * gridInterval;
        for (let t = startGrid; t <= this.viewEnd; t += gridInterval) {
            const x = this.timeToX(t);
            if (x >= 0 && x <= this.width) {
                this.ctx.moveTo(x, 0);
                this.ctx.lineTo(x, this.height);
            }
        }
        this.ctx.stroke(); // Batch stroke

        // Draw track separators
        this.ctx.beginPath();
        let y = 0;
        for (const track of this.tracks) {
            if (this.hiddenTracks.has(track.id)) continue;
            const trackHeight = (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;
            y += trackHeight;
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
        }
        this.ctx.stroke(); // Batch stroke
    }

    /**
     * Correctly finds visible slices including those starting before the view
     * but ending within it (overlapping).
     */
    findVisibleSlices(track, viewStart, viewEnd) {
        const slices = track.slices;
        if (slices.length === 0) return [];
        
        // 1. Find the "Safe Start Time"
        // Any slice ending inside the view MUST have started after (viewStart - maxDuration)
        // This prevents us from scanning from index 0 for every frame
        const maxDur = track.maxItemDuration || (this.timeRange.end - this.timeRange.start);
        const safeStartTime = viewStart - maxDur;

        // 2. Binary Search for the first index where startTime >= safeStartTime
        let startIdx = 0;
        let left = 0;
        let right = slices.length - 1;
        
        while (left <= right) {
            const mid = (left + right) >>> 1; // Bitwise divide by 2
            if (slices[mid].startTime < safeStartTime) {
                left = mid + 1;
            } else {
                startIdx = mid;
                right = mid - 1;
            }
        }

        // 3. Binary Search for the cut-off point where startTime > viewEnd
        // We don't need to look at anything that starts after the view ends
        let endIdx = slices.length;
        left = startIdx; // Optimization: start searching from where we left off
        right = slices.length - 1;

        while (left <= right) {
            const mid = (left + right) >>> 1;
            if (slices[mid].startTime > viewEnd) {
                endIdx = mid;
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }

        // 4. Collect Valid Slices
        // Iterate only the relevant subset and check for overlap
        const visible = [];
        for (let i = startIdx; i < endIdx; i++) {
            const slice = slices[i];
            // Overlap logic: Start is before ViewEnd (guaranteed by loop) AND End is after ViewStart
            if (slice.endTime > viewStart) {
                visible.push(slice);
            }
        }
        
        return visible;
    }

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

    drawSlicesOptimized() {
        let trackY = 0;
        const minSliceWidth = 0.5; 
        const collapsedHeight = 28;
        const viewDuration = this.viewEnd - this.viewStart;
        const widthPerTime = this.width / viewDuration;

    this.ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif';
        this.ctx.textBaseline = 'middle';

        for (const track of this.tracks) {
            const isHidden = this.hiddenTracks.has(track.id);
            const trackHeight = isHidden ? collapsedHeight : (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            if (trackY > this.height) break;
            if (trackY + trackHeight < 0) {
                trackY += trackHeight;
                continue;
            }

            if (isHidden) {
                this.ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
                this.ctx.fillRect(0, trackY, this.width, trackHeight);
                trackY += trackHeight;
                continue;
            }

            // CHANGE HERE: Pass the whole track object, not just slices
            const visibleSlices = this.findVisibleSlices(track, this.viewStart, this.viewEnd);

            // Pre-calculate color indices
            const sliceColorIdx = {};
            for (const slice of visibleSlices) {
                 let baseIdx = (slice.depth + (track.id || 0) * 3) % this.baseSliceColors.length;
                 sliceColorIdx[slice.id] = baseIdx;
            }

            for (const slice of visibleSlices) {
                const x1 = (slice.startTime - this.viewStart) * widthPerTime;
                const width = (slice.endTime - slice.startTime) * widthPerTime;
                
                if (width < minSliceWidth) continue;

                // Extra check: only draw if actually on screen (x1 + width > 0)
                if (x1 + width < 0 || x1 > this.width) continue;

                const colorIdx = sliceColorIdx[slice.id] || 0;
                this.drawSliceFast(slice, trackY, x1, width, colorIdx);
            }

            trackY += trackHeight;
        }
    }

    drawSliceFast(slice, trackY, x1, width, colorIdx) {
        const y = trackY + this.trackPadding + slice.depth * this.sliceHeight;
        const height = this.sliceHeight - 2;

        const visibleX1 = Math.max(0, x1);
        const visibleX2 = Math.min(this.width, x1 + width);
        const visibleWidth = visibleX2 - visibleX1;

        if (visibleWidth <= 0) return;

        const isSelected = this.selectedSlices.has(slice.id);
        const isHovered = this.hoveredSlice === slice;
        const isClicked = this.clickedSlice === slice;

        // Use cached colors
        const colors = this.colorCache[colorIdx % this.colorCache.length];

        if (isSelected) {
            this.ctx.fillStyle = colors.selected;
            this.ctx.fillRect(visibleX1, y, visibleWidth, height);
            this.ctx.strokeStyle = '#e94560';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(visibleX1, y, visibleWidth, height);
        } else if (isHovered) {
            this.ctx.fillStyle = colors.hover;
            this.ctx.fillRect(visibleX1, y, visibleWidth, height);
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(visibleX1, y, visibleWidth, height);
        } else if (isClicked) {
            this.ctx.fillStyle = colors.clicked;
            this.ctx.fillRect(visibleX1, y, visibleWidth, height);
            this.ctx.strokeStyle = '#e94560';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(visibleX1, y, visibleWidth, height);
        } else {
            // Optimization: FAST PATH - No stroke, just fill
            this.ctx.fillStyle = colors.normal;
            this.ctx.fillRect(visibleX1, y, visibleWidth, height);
        }

        // Text Optimization: Only draw if wide enough
        if (visibleWidth > 10) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(visibleX1, y, visibleWidth, height);
            this.ctx.clip();
            // Font is set once in drawSlicesOptimized
            const textPadding = 4;
            const textX = Math.max(visibleX1 + textPadding, x1 + textPadding);
            // Change text color if selected
            if (isSelected) {
                this.ctx.fillStyle = '#111';
            } else {
                this.ctx.fillStyle = '#fff';
            }
            this.ctx.fillText(slice.name, textX, y + height / 2);
            this.ctx.restore();
        }
    }

    drawSelectionOverlay() {
        const x1 = Math.min(this.selectionStart.x, this.selectionEnd.x);
        const y1 = Math.min(this.selectionStart.y, this.selectionEnd.y);
        const width = Math.abs(this.selectionEnd.x - this.selectionStart.x);
        const height = Math.abs(this.selectionEnd.y - this.selectionStart.y);

        this.ctx.fillStyle = this.selectionColor;
        this.ctx.fillRect(x1, y1, width, height);

        this.ctx.strokeStyle = '#e94560';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x1, y1, width, height);
    }

    drawRuler() {
        this.rulerCtx.fillStyle = '#0f3460';
        this.rulerCtx.fillRect(0, 0, this.rulerWidth, this.rulerHeight);

        const viewDuration = this.viewEnd - this.viewStart;
        const intervals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
        let gridInterval = intervals.find(i => viewDuration / i < 10) || 1000000;

        const startGrid = Math.floor(this.viewStart / gridInterval) * gridInterval;

        this.rulerCtx.strokeStyle = '#2a2a4a';
        this.rulerCtx.fillStyle = '#aaa';
        this.rulerCtx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        this.rulerCtx.textBaseline = 'top';
        this.rulerCtx.beginPath();

        for (let t = startGrid; t <= this.viewEnd; t += gridInterval) {
            const x = this.timeToX(t);
            if (x >= 0 && x <= this.rulerWidth) {
                this.rulerCtx.moveTo(x, 0);
                this.rulerCtx.lineTo(x, 8);
                // Draw text immediately as it's separate from path
                const label = (typeof TraceParser !== 'undefined') ? TraceParser.formatTimestamp(t) : t.toFixed(0);
                this.rulerCtx.fillText(label, x + 3, 10);
            }
        }
        this.rulerCtx.stroke();
    }

    timeToX(time) {
        return ((time - this.viewStart) / (this.viewEnd - this.viewStart)) * this.width;
    }

    xToTime(x) {
        return this.viewStart + (x / this.width) * (this.viewEnd - this.viewStart);
    }

    getSliceAtPosition(x, y) {
        // Optimization: Early bounds check
        if (x < 0 || x > this.width || y < 0 || y > this.height) return null;

        let trackY = 0;
        const collapsedHeight = 28;
        const time = this.xToTime(x);

        for (const track of this.tracks) {
            const isHidden = this.hiddenTracks.has(track.id);
            const trackHeight = isHidden ? collapsedHeight : (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            if (isHidden) {
                trackY += trackHeight;
                continue;
            }

            // Optimization: Only check tracks that vertically contain the mouse
            if (y >= trackY && y < trackY + trackHeight) {
                // Optimization: limit search range logic
                // Find where this time would be inserted
                const insertIdx = this.findFirstSliceStartingAfter(track.slices, time);
                
                // Scan backwards from insertion point
                // Check max 50 items or until time gap is too large
                // This covers parent slices without scanning the whole array
                let foundSlice = null;
                let maxDepth = -1;
                
                let count = 0;
                for (let i = insertIdx - 1; i >= 0; i--) {
                    const slice = track.slices[i];
                    count++;
                    
                    // Heuristic: If we've checked 100 items and the slice ends way before our time, stop.
                    // However, root slices can be very long, so we must be careful.
                    // Safest is to rely on the fact that if slice.endTime < time, it's not it.
                    if (slice.endTime < time) {
                         // Optimization: If this slice ends significantly before our time, 
                         // and it's not a root slice (depth 0), we might be able to break early?
                         // For now, just continue, linear scan backwards is usually fast enough 
                         // unless track has millions of slices.
                         continue;
                    }

                    if (time >= slice.startTime && time <= slice.endTime) {
                        const sliceY = trackY + this.trackPadding + slice.depth * this.sliceHeight;
                        if (y >= sliceY && y < sliceY + this.sliceHeight - 2) {
                            if (slice.depth > maxDepth) {
                                maxDepth = slice.depth;
                                foundSlice = slice;
                            }
                        }
                    }
                }
                return foundSlice;
            }
            trackY += trackHeight;
        }
        return null;
    }

    // ... (getSlicesInSelection kept similar but using scheduleRender)

    /**
     * Get slices in selection rectangle (Fix: passes track object to findVisibleSlices)
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
        const collapsedHeight = 28;

        for (const track of this.tracks) {
            const isHidden = this.hiddenTracks.has(track.id);
            const trackHeight = isHidden ? collapsedHeight : (track.maxDepth || 1) * this.sliceHeight + this.trackPadding * 2;

            if (isHidden) {
                trackY += trackHeight;
                continue;
            }
            
            // Check intersection of track rect and selection rect
            if (y2 >= trackY && y1 < trackY + trackHeight) {
                // FIX: Pass 'track' object, NOT 'track.slices'
                const visibleSlices = this.findVisibleSlices(track, t1, t2);
                
                for (const slice of visibleSlices) {
                    const sliceY = trackY + this.trackPadding + slice.depth * this.sliceHeight;
                    
                    // Check Y overlap & X overlap
                    // (findVisibleSlices checks time/X, but we verify exact bounds here)
                    if (y2 >= sliceY && y1 < sliceY + this.sliceHeight - 2) {
                        // Double check time overlap for strict selection
                        // (Optional, but good for precision)
                        const sliceStart = slice.startTime;
                        const sliceEnd = slice.endTime;
                        
                        // Overlap logic: max(start1, start2) < min(end1, end2)
                        if (Math.max(t1, sliceStart) < Math.min(t2, sliceEnd)) {
                            selected.push(slice);
                        }
                    }
                }
            }
            trackY += trackHeight;
        }

        return selected;
    }

    handleMouseDown(e) {
        const pos = this.getMousePos(e);
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        const slice = this.getSliceAtPosition(pos.x, pos.y);
        
        if (this.interactionMode === 'select' || e.shiftKey) {
            if (slice && !e.shiftKey) {
                if (e.ctrlKey || e.metaKey) {
                    this.selectedSlices.has(slice.id) ? this.selectedSlices.delete(slice.id) : this.selectedSlices.add(slice.id);
                } else {
                    this.selectedSlices.clear();
                    this.selectedSlices.add(slice.id);
                }
                this.clickedSlice = slice;
                if (this.onSliceClick) this.onSliceClick(slice);
                if (this.onSelectionChange) this.onSelectionChange(this.getSelectedSlices());
            } else {
                this.isSelecting = true;
                this.selectionStart = { ...pos };
                this.selectionEnd = { ...pos };
                this.clickedSlice = null;
            }
        } else {
            // ... (keep pan logic)
            if (slice) {
                // Same fix for single click selection in pan mode
                 if (e.ctrlKey || e.metaKey) {
                    this.selectedSlices.has(slice.id) ? this.selectedSlices.delete(slice.id) : this.selectedSlices.add(slice.id);
                } else {
                    this.selectedSlices.clear();
                    this.selectedSlices.add(slice.id);
                }
                // ...
            } else {
                this.isPanning = true;
                this.panStartView = this.viewStart;
            }
        }
        this.scheduleRender();
    }

    handleMouseMove(e) {
        // Optimization: Don't do heavy logic if mouse isn't over canvas
        const pos = this.getMousePos(e);

        if (this.isSelecting) {
            this.selectionEnd = { ...pos };
            this.scheduleRender();
        } else if (this.isPanning) {
            const dx = pos.x - this.dragStartX;
            const viewDuration = this.viewEnd - this.viewStart;
            const timeDelta = (dx / this.width) * viewDuration;
            
            let newStart = this.panStartView - timeDelta;
            let newEnd = newStart + viewDuration;
            
            // Bounds check
            if (newStart < this.timeRange.start) { newStart = this.timeRange.start; newEnd = newStart + viewDuration; }
            if (newEnd > this.timeRange.end) { newEnd = this.timeRange.end; newStart = newEnd - viewDuration; }
            
            this.viewStart = newStart;
            this.viewEnd = newEnd;
            this.scheduleRender();
        } else {
            // Hover logic
            const slice = this.getSliceAtPosition(pos.x, pos.y);
            if (slice !== this.hoveredSlice) {
                this.hoveredSlice = slice;
                this.scheduleRender();
                if (this.onSliceHover) this.onSliceHover(slice, e.clientX, e.clientY);
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
            if (this.onSelectionChange) this.onSelectionChange(this.getSelectedSlices());
        }
        this.isPanning = false;
        this.updateCursor();
        this.scheduleRender();
    }

    handleMouseLeave(e) {
        this.hoveredSlice = null;
        this.isPanning = false;
        this.isSelecting = false;
        this.updateCursor();
        if (this.onSliceHover) this.onSliceHover(null);
        this.scheduleRender();
    }

    handleWheel(e) {
        e.preventDefault();
        const pos = this.getMousePos(e);
        const viewDuration = this.viewEnd - this.viewStart;
        const traceDuration = this.timeRange.end - this.timeRange.start;

        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            // Pan
            const panAmount = (e.deltaX / this.width) * viewDuration;
            this.viewStart += panAmount;
            this.viewEnd += panAmount;
            if (this.viewStart < this.timeRange.start) { this.viewStart = this.timeRange.start; this.viewEnd = this.viewStart + viewDuration; }
            if (this.viewEnd > this.timeRange.end) { this.viewEnd = this.timeRange.end; this.viewStart = this.viewEnd - viewDuration; }
        } else {
            // Zoom
            const x = pos.x;
            const zoomPoint = this.xToTime(x);
            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
            const newDuration = viewDuration * zoomFactor;

            const ratio = (zoomPoint - this.viewStart) / viewDuration;
            this.viewStart = zoomPoint - ratio * newDuration;
            this.viewEnd = this.viewStart + newDuration;

            if (newDuration > traceDuration) {
                this.viewStart = this.timeRange.start;
                this.viewEnd = this.timeRange.end;
            } else {
                if (this.viewStart < this.timeRange.start) { this.viewStart = this.timeRange.start; this.viewEnd = this.viewStart + newDuration; }
                if (this.viewEnd > this.timeRange.end) { this.viewEnd = this.timeRange.end; this.viewStart = this.viewEnd - newDuration; }
            }
            this.zoom = traceDuration / (this.viewEnd - this.viewStart);
        }
        this.scheduleRender();
    }

    handleDoubleClick(e) {
        const pos = this.getMousePos(e);
        const slice = this.getSliceAtPosition(pos.x, pos.y);
        if (slice) {
            const padding = slice.duration * 0.2;
            this.viewStart = Math.max(this.timeRange.start, slice.startTime - padding);
            this.viewEnd = Math.min(this.timeRange.end, slice.endTime + padding);
            this.zoom = (this.timeRange.end - this.timeRange.start) / (this.viewEnd - this.viewStart);
            this.scheduleRender();
        }
    }

    handleKeyDown(e) {
        const isTyping = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
        if (e.key === 'Escape') {
            this.clearSelection();
            this.setMode('select');
        } else if (e.key === ' ' && !isTyping) {
            e.preventDefault();
            this.setMode('pan');
        } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.selectAll();
        } else if ((e.key === 'p' || e.key === 'P') && !isTyping) {
            this.setMode('pan');
        } else if ((e.key === 's' || e.key === 'S') && !isTyping) {
            this.setMode('select');
        }
    }

    setMode(mode) {
        if (mode !== 'pan' && mode !== 'select') return;
        this.interactionMode = mode;
        this.updateCursor();
        if (this.onModeChange) this.onModeChange(mode);
    }

    getMode() { return this.interactionMode; }
    
    updateCursor() {
        this.canvasContainer.classList.remove('pan-mode', 'select-mode');
        this.canvasContainer.classList.add(`${this.interactionMode}-mode`);
    }

    getSelectedSlices() { return this.slices.filter(slice => this.selectedSlices.has(slice.id)); }
    
    getSelectedSlicesForExport() {
        return this.slices.filter(slice => this.selectedSlices.has(slice.id) && !this.hiddenTracks.has(slice.trackId));
    }

    clearSelection() {
        this.selectedSlices.clear();
        this.clickedSlice = null;
        if (this.onSelectionChange) this.onSelectionChange([]);
        this.scheduleRender();
    }

    selectAll() {
        const visibleSlices = this.slices.filter(slice => 
            slice.endTime >= this.viewStart && slice.startTime <= this.viewEnd && !this.hiddenTracks.has(slice.trackId)
        );
        visibleSlices.forEach(slice => this.selectedSlices.add(slice.id));
        if (this.onSelectionChange) this.onSelectionChange(this.getSelectedSlices());
        this.scheduleRender();
    }

    zoomIn() {
        const center = (this.viewStart + this.viewEnd) / 2;
        const viewDuration = (this.viewEnd - this.viewStart) * 0.5;
        this.viewStart = center - viewDuration / 2;
        this.viewEnd = center + viewDuration / 2;
        this.zoom = (this.timeRange.end - this.timeRange.start) / (this.viewEnd - this.viewStart);
        this.scheduleRender();
    }

    zoomOut() {
        const center = (this.viewStart + this.viewEnd) / 2;
        const viewDuration = Math.min((this.viewEnd - this.viewStart) * 2, this.timeRange.end - this.timeRange.start);
        this.viewStart = Math.max(this.timeRange.start, center - viewDuration / 2);
        this.viewEnd = Math.min(this.timeRange.end, center + viewDuration / 2);
        this.zoom = (this.timeRange.end - this.timeRange.start) / (this.viewEnd - this.viewStart);
        this.scheduleRender();
    }

    resetView() {
        this.viewStart = this.timeRange.start;
        this.viewEnd = this.timeRange.end;
        this.zoom = 1;
        this.scheduleRender();
    }

    getZoomLevel() { return Math.round(this.zoom * 100); }

    // Color helpers - only used during initialization now
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

window.TraceViewer = TraceViewer;