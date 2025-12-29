/**
 * LLM Exporter
 * Converts selected trace slices to LLM-parseable formats
 */

class LLMExporter {
    constructor() {
        this.formats = {
            structured: this.toStructuredText.bind(this),
            markdown: this.toMarkdown.bind(this),
            json: this.toJSON.bind(this),
            analysis: this.toAnalysisPrompt.bind(this)
        };
    }

    /**
     * Get min/max from array safely (avoids stack overflow with large arrays)
     */
    static getTimeRange(slices) {
        let start = Infinity;
        let end = -Infinity;
        for (const s of slices) {
            if (s.startTime < start) start = s.startTime;
            if (s.endTime > end) end = s.endTime;
        }
        return { start, end };
    }

    /**
     * Get min/max duration from array safely
     */
    static getDurationRange(durations) {
        let min = Infinity;
        let max = -Infinity;
        for (const d of durations) {
            if (d < min) min = d;
            if (d > max) max = d;
        }
        return { min, max };
    }

    /**
     * Export slices to specified format
     * @param {Array} slices - Array of slice objects
     * @param {Array} tracks - Array of track objects
     * @param {string} format - Export format
     * @param {Object} viewInfo - Current view information
     * @returns {string} Formatted output
     */
    export(slices, tracks, format = 'structured', viewInfo = {}) {
        if (!slices || slices.length === 0) {
            return 'No slices selected. Select slices by clicking or drag-selecting in the trace view.';
        }

        const formatter = this.formats[format] || this.formats.structured;
        return formatter(slices, tracks, viewInfo);
    }

    /**
     * Get track info for a slice
     */
    getTrackForSlice(slice, tracks) {
        return tracks.find(t => t.id === slice.trackId) || { name: 'Unknown', processName: 'Unknown' };
    }

    /**
     * Format to structured text - compact format optimized for LLM parsing
     */
    toStructuredText(slices, tracks, viewInfo) {
        const lines = [];
        
        // Compact summary
        const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
        const timeRange = LLMExporter.getTimeRange(slices);
        const span = timeRange.end - timeRange.start;
        
        lines.push(`TRACE: ${slices.length} slices | ${TraceParser.formatDuration(totalDuration)} total | ${TraceParser.formatDuration(span)} span`);
        lines.push('');

        // Group by track
        const byTrack = this.groupByTrack(slices, tracks);
        
        Object.entries(byTrack).forEach(([trackName, trackSlices]) => {
            lines.push(`[${trackName}] (${trackSlices.length})`);
            
            // Sort by start time
            trackSlices.sort((a, b) => a.startTime - b.startTime);
            
            trackSlices.forEach(slice => {
                const argsStr = slice.args && Object.keys(slice.args).length > 0 
                    ? ` ${JSON.stringify(slice.args)}` 
                    : '';
                lines.push(`  ${TraceParser.formatTimestamp(slice.startTime)} +${TraceParser.formatDuration(slice.duration)} ${slice.name}${argsStr}`);
            });
            lines.push('');
        });

        // Compact stats - only show if multiple slices
        if (slices.length > 1) {
            const stats = this.calculateStats(slices);
            lines.push(`STATS: avg=${TraceParser.formatDuration(stats.avgDuration)} min=${TraceParser.formatDuration(stats.minDuration)} max=${TraceParser.formatDuration(stats.maxDuration)}`);
            
            // Top 3 by duration
            const top3 = stats.topByDuration.slice(0, 3).map(s => `${s.name}(${TraceParser.formatDuration(s.duration)})`).join(', ');
            lines.push(`TOP: ${top3}`);
        }

        return lines.join('\n');
    }

    /**
     * Format to Markdown - compact table format
     */
    toMarkdown(slices, tracks, viewInfo) {
        const lines = [];
        
        const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
        const timeRange = LLMExporter.getTimeRange(slices);
        
        lines.push(`# Trace: ${slices.length} slices | ${TraceParser.formatDuration(totalDuration)} | ${TraceParser.formatDuration(timeRange.end - timeRange.start)} span`);
        lines.push('');

        // Compact slices table
        lines.push('| Name | Track | Start | Duration |');
        lines.push('|------|-------|-------|----------|');
        
        slices.sort((a, b) => a.startTime - b.startTime).forEach(slice => {
            const track = this.getTrackForSlice(slice, tracks);
            lines.push(`| ${slice.name} | ${track.name} | ${TraceParser.formatTimestamp(slice.startTime)} | ${TraceParser.formatDuration(slice.duration)} |`);
        });

        // Only show args if present and not too many
        const slicesWithArgs = slices.filter(s => s.args && Object.keys(s.args).length > 0);
        if (slicesWithArgs.length > 0 && slicesWithArgs.length <= 10) {
            lines.push('');
            lines.push('## Args');
            slicesWithArgs.forEach(slice => {
                lines.push(`**${slice.name}**: \`${JSON.stringify(slice.args)}\``);
            });
        }

        return lines.join('\n');
    }

    /**
     * Format to JSON - for programmatic use
     */
    toJSON(slices, tracks, viewInfo) {
        const timeRange = LLMExporter.getTimeRange(slices);

        const exportData = {
            metadata: {
                exportTime: new Date().toISOString(),
                sliceCount: slices.length,
                timeRange: {
                    start: timeRange.start,
                    end: timeRange.end,
                    startFormatted: TraceParser.formatTimestamp(timeRange.start),
                    endFormatted: TraceParser.formatTimestamp(timeRange.end)
                },
                totalDuration: slices.reduce((sum, s) => sum + s.duration, 0)
            },
            slices: slices.map(slice => {
                const track = this.getTrackForSlice(slice, tracks);
                return {
                    id: slice.id,
                    name: slice.name,
                    category: slice.category,
                    track: {
                        name: track.name,
                        processName: track.processName
                    },
                    timing: {
                        start: slice.startTime,
                        end: slice.endTime,
                        duration: slice.duration,
                        startFormatted: TraceParser.formatTimestamp(slice.startTime),
                        durationFormatted: TraceParser.formatDuration(slice.duration)
                    },
                    args: slice.args || {}
                };
            }),
            statistics: this.calculateStats(slices)
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Format as analysis prompt - compact format for LLM analysis
     */
    toAnalysisPrompt(slices, tracks, viewInfo) {
        const lines = [];
        
        const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
        const timeRange = LLMExporter.getTimeRange(slices);
        const stats = this.calculateStats(slices);
        
        lines.push('Analyze this performance trace:');
        lines.push('');
        lines.push(`${slices.length} slices | ${TraceParser.formatDuration(timeRange.end - timeRange.start)} span | ${TraceParser.formatDuration(totalDuration)} total`);
        lines.push(`Duration: avg=${TraceParser.formatDuration(stats.avgDuration)} min=${TraceParser.formatDuration(stats.minDuration)} max=${TraceParser.formatDuration(stats.maxDuration)}`);
        lines.push('');

        // Group by track - compact format
        const byTrack = this.groupByTrack(slices, tracks);
        
        Object.entries(byTrack).forEach(([trackName, trackSlices]) => {
            lines.push(`[${trackName}]`);
            trackSlices.sort((a, b) => a.startTime - b.startTime);
            trackSlices.forEach(slice => {
                const argsStr = slice.args && Object.keys(slice.args).length > 0 ? ` ${JSON.stringify(slice.args)}` : '';
                lines.push(`  ${TraceParser.formatTimestamp(slice.startTime)} +${TraceParser.formatDuration(slice.duration)} ${slice.name}${argsStr}`);
            });
        });
        lines.push('');
        
        // Top hotspots
        lines.push('Hotspots: ' + stats.topByDuration.slice(0, 3).map(s => `${s.name}(${TraceParser.formatDuration(s.duration)})`).join(', '));
        lines.push('');
        lines.push('Identify: bottlenecks, optimization opportunities, anomalies');

        return lines.join('\n');
    }

    /**
     * Group slices by track
     */
    groupByTrack(slices, tracks) {
        const groups = {};
        
        slices.forEach(slice => {
            const track = this.getTrackForSlice(slice, tracks);
            const key = `${track.processName} > ${track.name}`;
            
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(slice);
        });
        
        return groups;
    }

    /**
     * Calculate statistics for slices
     */
    calculateStats(slices) {
        if (slices.length === 0) {
            return {
                uniqueNames: 0,
                avgDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                topByDuration: [],
                nameFrequency: {}
            };
        }

        const durations = slices.map(s => s.duration);
        const uniqueNames = new Set(slices.map(s => s.name)).size;
        
        const nameFrequency = {};
        slices.forEach(s => {
            nameFrequency[s.name] = (nameFrequency[s.name] || 0) + 1;
        });

        const topByDuration = [...slices]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 5);

        const durationRange = LLMExporter.getDurationRange(durations);

        return {
            uniqueNames,
            avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
            minDuration: durationRange.min,
            maxDuration: durationRange.max,
            topByDuration,
            nameFrequency
        };
    }

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                document.execCommand('copy');
                document.body.removeChild(textarea);
                return true;
            } catch (e) {
                document.body.removeChild(textarea);
                return false;
            }
        }
    }
}

// Export for use in other files
window.LLMExporter = LLMExporter;
