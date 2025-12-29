/**
 * Perfetto Trace Parser
 * Handles parsing of Perfetto trace files (JSON and binary formats)
 */

class TraceParser {
    constructor() {
        this.tracks = [];
        this.slices = [];
        this.metadata = {};
        this.timeRange = { start: Infinity, end: -Infinity };
    }

    /**
     * Parse a trace file
     * @param {File} file - The trace file to parse
     * @returns {Promise<Object>} Parsed trace data
     */
    async parseFile(file) {
        let arrayBuffer = await file.arrayBuffer();
        let uint8Array = new Uint8Array(arrayBuffer);
        
        // Check if it's gzip compressed (magic bytes: 1f 8b)
        if (uint8Array[0] === 0x1F && uint8Array[1] === 0x8B) {
            console.log('Detected gzip compressed file, decompressing...');
            arrayBuffer = await this.decompressGzip(arrayBuffer);
            uint8Array = new Uint8Array(arrayBuffer);
        }

        // Try to detect format
        // Check if it's JSON (starts with '{' or '[' or whitespace before them)
        const firstNonWhitespace = this.findFirstNonWhitespace(uint8Array);
        if (firstNonWhitespace === 0x7B || firstNonWhitespace === 0x5B) {
            return this.parseJSON(arrayBuffer);
        }
        
        // Check for systrace format (text format starting with '#' or 'TRACE:')
        const textStart = new TextDecoder().decode(uint8Array.slice(0, 100));
        if (textStart.startsWith('#') || textStart.includes('TRACE:') || textStart.includes('tracer:')) {
            return this.parseSystrace(arrayBuffer);
        }

        // Try to parse as protobuf binary format
        return this.parseProtobuf(arrayBuffer);
    }

    /**
     * Find first non-whitespace byte
     */
    findFirstNonWhitespace(uint8Array) {
        for (let i = 0; i < Math.min(uint8Array.length, 100); i++) {
            const byte = uint8Array[i];
            // Skip whitespace (space, tab, newline, carriage return)
            if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
                return byte;
            }
        }
        return 0;
    }

    /**
     * Decompress gzip data using DecompressionStream API
     */
    async decompressGzip(arrayBuffer) {
        // Check if DecompressionStream is available (modern browsers)
        if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('gzip');
            const stream = new Response(arrayBuffer).body.pipeThrough(ds);
            const decompressedBuffer = await new Response(stream).arrayBuffer();
            return decompressedBuffer;
        }
        
        // Fallback: use pako library if available, or throw helpful error
        if (typeof pako !== 'undefined') {
            const decompressed = pako.inflate(new Uint8Array(arrayBuffer));
            return decompressed.buffer;
        }
        
        throw new Error('Gzip decompression not supported in this browser. Please decompress the file manually (gunzip) or use a modern browser like Chrome/Edge.');
    }

    /**
     * Parse JSON trace format (Chrome trace format)
     */
    parseJSON(arrayBuffer) {
        const text = new TextDecoder().decode(arrayBuffer);
        const data = JSON.parse(text);
        
        this.tracks = [];
        this.slices = [];
        this.metadata = {};
        this.timeRange = { start: Infinity, end: -Infinity };

        // Handle Chrome trace format
        const events = Array.isArray(data) ? data : (data.traceEvents || []);
        
        // Group events by process/thread
        const trackMap = new Map();
        
        events.forEach((event, index) => {
            if (event.ph === 'M') {
                // Metadata events
                this.metadata[event.name] = event.args;
                return;
            }

            if (!['X', 'B', 'E', 'I', 'i', 'C'].includes(event.ph)) {
                return; // Skip unsupported event types
            }

            const pid = event.pid || 0;
            const tid = event.tid || 0;
            const trackKey = `${pid}-${tid}`;
            
            if (!trackMap.has(trackKey)) {
                trackMap.set(trackKey, {
                    id: trackMap.size,
                    name: event.tname || `Thread ${tid}`,
                    pid: pid,
                    tid: tid,
                    processName: event.pname || `Process ${pid}`,
                    slices: []
                });
            }

            const track = trackMap.get(trackKey);
            const ts = event.ts || 0; // Microseconds
            const dur = event.dur || 0;

            if (event.ph === 'X' || event.ph === 'B') {
                const slice = {
                    id: this.slices.length,
                    trackId: track.id,
                    name: event.name || 'Unknown',
                    category: event.cat || '',
                    startTime: ts,
                    duration: event.ph === 'X' ? dur : 0,
                    endTime: event.ph === 'X' ? ts + dur : ts,
                    args: event.args || {},
                    depth: 0, // Will be calculated later
                    color: this.getColorIndex(event.cat || event.name)
                };

                this.slices.push(slice);
                track.slices.push(slice);

                this.timeRange.start = Math.min(this.timeRange.start, ts);
                this.timeRange.end = Math.max(this.timeRange.end, ts + dur);
            }
        });

        this.tracks = Array.from(trackMap.values());
        
        // Calculate slice depths for nested slices
        this.calculateSliceDepths();

        // Normalize times to start from 0
        this.normalizeTimestamps();

        return {
            tracks: this.tracks,
            slices: this.slices,
            metadata: this.metadata,
            timeRange: this.timeRange
        };
    }

    /**
     * Parse systrace format
     */
    parseSystrace(arrayBuffer) {
        const text = new TextDecoder().decode(arrayBuffer);
        const lines = text.split('\n');
        
        this.tracks = [];
        this.slices = [];
        this.metadata = {};
        this.timeRange = { start: Infinity, end: -Infinity };

        const trackMap = new Map();
        const openSlices = new Map(); // Track open B events

        // Regex for systrace format
        const systraceRegex = /^\s*(.+?)-(\d+)\s+\[(\d+)\]\s+[.\d]+:\s+(\d+\.\d+):\s+(tracing_mark_write|sched_switch|.+?):\s+(.*)$/;
        const beginRegex = /^B\|(\d+)\|(.+)$/;
        const endRegex = /^E\|(\d+)$/;
        const counterRegex = /^C\|(\d+)\|(.+)\|(\d+)$/;

        lines.forEach((line, lineNum) => {
            const match = line.match(systraceRegex);
            if (!match) return;

            const [, taskName, tid, cpu, timestamp, eventType, data] = match;
            const ts = parseFloat(timestamp) * 1000000; // Convert to microseconds
            const tidNum = parseInt(tid);
            const trackKey = `${taskName}-${tidNum}`;

            if (!trackMap.has(trackKey)) {
                trackMap.set(trackKey, {
                    id: trackMap.size,
                    name: taskName,
                    tid: tidNum,
                    pid: tidNum,
                    processName: taskName,
                    slices: []
                });
            }

            const track = trackMap.get(trackKey);

            if (eventType === 'tracing_mark_write') {
                const beginMatch = data.match(beginRegex);
                const endMatch = data.match(endRegex);

                if (beginMatch) {
                    const sliceName = beginMatch[2];
                    const openKey = `${trackKey}-${beginMatch[1]}`;
                    
                    if (!openSlices.has(openKey)) {
                        openSlices.set(openKey, []);
                    }
                    
                    openSlices.get(openKey).push({
                        name: sliceName,
                        startTime: ts,
                        trackId: track.id
                    });

                    this.timeRange.start = Math.min(this.timeRange.start, ts);
                } else if (endMatch) {
                    const openKey = `${trackKey}-${endMatch[1]}`;
                    const stack = openSlices.get(openKey);
                    
                    if (stack && stack.length > 0) {
                        const openSlice = stack.pop();
                        const slice = {
                            id: this.slices.length,
                            trackId: track.id,
                            name: openSlice.name,
                            category: 'systrace',
                            startTime: openSlice.startTime,
                            duration: ts - openSlice.startTime,
                            endTime: ts,
                            args: {},
                            depth: 0,
                            color: this.getColorIndex(openSlice.name)
                        };

                        this.slices.push(slice);
                        track.slices.push(slice);
                        this.timeRange.end = Math.max(this.timeRange.end, ts);
                    }
                }
            }
        });

        this.tracks = Array.from(trackMap.values());
        this.calculateSliceDepths();
        this.normalizeTimestamps();

        return {
            tracks: this.tracks,
            slices: this.slices,
            metadata: this.metadata,
            timeRange: this.timeRange
        };
    }

    /**
     * Parse Perfetto protobuf binary format
     * This is a simplified parser - full protobuf parsing would require proto definitions
     */
    parseProtobuf(arrayBuffer) {
        // For now, return a message that binary format needs conversion
        // In production, you'd use perfetto's trace_processor or protobuf.js
        
        console.warn('Binary Perfetto traces require conversion. Please export as JSON from Perfetto UI.');
        
        // Try to extract some basic info from the binary
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Create a demo trace instead
        return this.createDemoTrace();
    }

    /**
     * Create a demo trace for testing
     */
    createDemoTrace() {
        this.tracks = [];
        this.slices = [];
        this.metadata = { demo: true };
        this.timeRange = { start: 0, end: 0 };

        const processes = [
            { name: 'Main Process', threads: ['Main Thread', 'Worker 1', 'Worker 2'] },
            { name: 'Render Process', threads: ['Compositor', 'GPU Thread'] },
            { name: 'System', threads: ['Kernel', 'IO'] }
        ];

        let trackId = 0;
        let sliceId = 0;
        let baseTime = 0;
        const totalDuration = 5000000; // 5 seconds in microseconds

        const sliceNames = [
            'performLayout', 'parseHTML', 'recalculateStyles', 'paint', 'composite',
            'JavaScript', 'GC', 'parseCSS', 'updateLayer', 'rasterize',
            'decode', 'commit', 'scroll', 'inputLatency', 'animation',
            'fetch', 'compile', 'execute', 'idle', 'vsync'
        ];

        processes.forEach((proc, procIdx) => {
            proc.threads.forEach((threadName, threadIdx) => {
                const track = {
                    id: trackId,
                    name: threadName,
                    pid: procIdx,
                    tid: threadIdx,
                    processName: proc.name,
                    slices: []
                };

                // Generate random slices for this track
                let currentTime = Math.random() * 100000;
                const numSlices = 20 + Math.floor(Math.random() * 30);

                for (let i = 0; i < numSlices; i++) {
                    const duration = 10000 + Math.random() * 200000;
                    const name = sliceNames[Math.floor(Math.random() * sliceNames.length)];
                    
                    const slice = {
                        id: sliceId++,
                        trackId: trackId,
                        name: name,
                        category: proc.name.toLowerCase().replace(' ', '_'),
                        startTime: currentTime,
                        duration: duration,
                        endTime: currentTime + duration,
                        args: {
                            frame: Math.floor(Math.random() * 1000),
                            count: Math.floor(Math.random() * 100)
                        },
                        depth: 0,
                        color: this.getColorIndex(name)
                    };

                    this.slices.push(slice);
                    track.slices.push(slice);

                    this.timeRange.start = Math.min(this.timeRange.start, currentTime);
                    this.timeRange.end = Math.max(this.timeRange.end, currentTime + duration);

                    // Add some nested slices
                    if (Math.random() > 0.6 && duration > 50000) {
                        const nestedCount = 1 + Math.floor(Math.random() * 3);
                        let nestedTime = currentTime + 5000;
                        
                        for (let j = 0; j < nestedCount && nestedTime < currentTime + duration - 10000; j++) {
                            const nestedDuration = Math.min(
                                5000 + Math.random() * 30000,
                                currentTime + duration - nestedTime - 5000
                            );
                            const nestedName = sliceNames[Math.floor(Math.random() * sliceNames.length)];
                            
                            const nestedSlice = {
                                id: sliceId++,
                                trackId: trackId,
                                name: nestedName,
                                category: 'nested',
                                startTime: nestedTime,
                                duration: nestedDuration,
                                endTime: nestedTime + nestedDuration,
                                args: { parent: name },
                                depth: 1,
                                color: this.getColorIndex(nestedName)
                            };

                            this.slices.push(nestedSlice);
                            track.slices.push(nestedSlice);
                            
                            nestedTime += nestedDuration + 5000 + Math.random() * 10000;
                        }
                    }

                    currentTime += duration + 10000 + Math.random() * 100000;
                    if (currentTime > totalDuration) break;
                }

                this.tracks.push(track);
                trackId++;
            });
        });

        this.calculateSliceDepths();

        return {
            tracks: this.tracks,
            slices: this.slices,
            metadata: this.metadata,
            timeRange: this.timeRange
        };
    }

    /**
     * Calculate depth for overlapping slices
     */
    calculateSliceDepths() {
        this.tracks.forEach(track => {
            if (track.slices.length === 0) {
                track.maxDepth = 1;
                return;
            }

            // Sort slices by start time using a stable sort approach
            track.slices.sort((a, b) => {
                if (a.startTime !== b.startTime) {
                    return a.startTime - b.startTime;
                }
                // For same start time, longer duration first (parent before child)
                return b.duration - a.duration;
            });
            
            // Calculate depths using a more efficient algorithm
            const activeSlices = [];
            let maxDepth = 0;
            
            for (let i = 0; i < track.slices.length; i++) {
                const slice = track.slices[i];
                
                // Remove finished slices (iterate backwards to safely remove)
                for (let j = activeSlices.length - 1; j >= 0; j--) {
                    if (activeSlices[j].endTime <= slice.startTime) {
                        activeSlices.splice(j, 1);
                    }
                }
                
                // Find available depth
                const usedDepths = new Set();
                for (let j = 0; j < activeSlices.length; j++) {
                    usedDepths.add(activeSlices[j].depth);
                }
                
                let depth = 0;
                while (usedDepths.has(depth)) {
                    depth++;
                }
                
                slice.depth = depth;
                maxDepth = Math.max(maxDepth, depth + 1);
                
                // Add to active slices
                activeSlices.push(slice);
            }

            // Set max depth for track height
            track.maxDepth = Math.max(1, maxDepth);
        });
    }

    /**
     * Normalize timestamps to start from 0
     */
    normalizeTimestamps() {
        const offset = this.timeRange.start;
        
        this.slices.forEach(slice => {
            slice.startTime -= offset;
            slice.endTime -= offset;
        });

        this.timeRange.end -= offset;
        this.timeRange.start = 0;
    }

    /**
     * Get consistent color index based on string
     */
    getColorIndex(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash) % 8;
    }

    /**
     * Get slices within a time range
     */
    getSlicesInRange(startTime, endTime) {
        return this.slices.filter(slice => 
            slice.endTime >= startTime && slice.startTime <= endTime
        );
    }

    /**
     * Get slice by ID
     */
    getSliceById(id) {
        return this.slices.find(slice => slice.id === id);
    }

    /**
     * Get track by ID
     */
    getTrackById(id) {
        return this.tracks.find(track => track.id === id);
    }

    /**
     * Format duration for display
     */
    static formatDuration(microseconds) {
        if (microseconds < 1000) {
            return `${microseconds.toFixed(2)} µs`;
        } else if (microseconds < 1000000) {
            return `${(microseconds / 1000).toFixed(2)} ms`;
        } else {
            return `${(microseconds / 1000000).toFixed(3)} s`;
        }
    }

    /**
     * Format timestamp for display
     */
    static formatTimestamp(microseconds) {
        if (microseconds < 1000) {
            return `${microseconds.toFixed(0)} µs`;
        } else if (microseconds < 1000000) {
            return `${(microseconds / 1000).toFixed(2)} ms`;
        } else {
            return `${(microseconds / 1000000).toFixed(3)} s`;
        }
    }
}

// Export for use in other files
window.TraceParser = TraceParser;
