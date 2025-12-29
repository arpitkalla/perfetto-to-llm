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
     * Format to structured text - optimized for LLM parsing
     */
    toStructuredText(slices, tracks, viewInfo) {
        const lines = [];
        
        lines.push('='.repeat(60));
        lines.push('PERFETTO TRACE DATA EXPORT');
        lines.push('='.repeat(60));
        lines.push('');
        
        // Summary
        lines.push('## SUMMARY');
        lines.push(`Total Slices: ${slices.length}`);
        
        const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
        lines.push(`Total Duration: ${TraceParser.formatDuration(totalDuration)}`);
        
        const timeRange = {
            start: Math.min(...slices.map(s => s.startTime)),
            end: Math.max(...slices.map(s => s.endTime))
        };
        lines.push(`Time Range: ${TraceParser.formatTimestamp(timeRange.start)} - ${TraceParser.formatTimestamp(timeRange.end)}`);
        lines.push(`Span: ${TraceParser.formatDuration(timeRange.end - timeRange.start)}`);
        lines.push('');

        // Group by track
        const byTrack = this.groupByTrack(slices, tracks);
        
        lines.push('## SLICES BY TRACK');
        lines.push('-'.repeat(40));
        
        Object.entries(byTrack).forEach(([trackName, trackSlices]) => {
            lines.push('');
            lines.push(`### ${trackName}`);
            lines.push(`Slice Count: ${trackSlices.length}`);
            lines.push('');
            
            // Sort by start time
            trackSlices.sort((a, b) => a.startTime - b.startTime);
            
            trackSlices.forEach((slice, idx) => {
                lines.push(`[${idx + 1}] ${slice.name}`);
                lines.push(`    Start: ${TraceParser.formatTimestamp(slice.startTime)}`);
                lines.push(`    Duration: ${TraceParser.formatDuration(slice.duration)}`);
                lines.push(`    Category: ${slice.category || 'none'}`);
                
                if (slice.args && Object.keys(slice.args).length > 0) {
                    lines.push(`    Args: ${JSON.stringify(slice.args)}`);
                }
                lines.push('');
            });
        });

        // Statistics
        lines.push('## STATISTICS');
        lines.push('-'.repeat(40));
        
        const stats = this.calculateStats(slices);
        lines.push(`Unique Slice Names: ${stats.uniqueNames}`);
        lines.push(`Average Duration: ${TraceParser.formatDuration(stats.avgDuration)}`);
        lines.push(`Min Duration: ${TraceParser.formatDuration(stats.minDuration)}`);
        lines.push(`Max Duration: ${TraceParser.formatDuration(stats.maxDuration)}`);
        lines.push('');
        
        lines.push('Top Slices by Duration:');
        stats.topByDuration.forEach((s, i) => {
            lines.push(`  ${i + 1}. ${s.name} - ${TraceParser.formatDuration(s.duration)}`);
        });
        lines.push('');

        lines.push('Slice Name Frequency:');
        Object.entries(stats.nameFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([name, count]) => {
                lines.push(`  - ${name}: ${count} occurrences`);
            });

        lines.push('');
        lines.push('='.repeat(60));
        lines.push('END OF EXPORT');
        lines.push('='.repeat(60));

        return lines.join('\n');
    }

    /**
     * Format to Markdown - good for documentation
     */
    toMarkdown(slices, tracks, viewInfo) {
        const lines = [];
        
        lines.push('# Perfetto Trace Export');
        lines.push('');
        lines.push('## Summary');
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Total Slices | ${slices.length} |`);
        
        const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
        lines.push(`| Total Duration | ${TraceParser.formatDuration(totalDuration)} |`);
        
        const timeRange = {
            start: Math.min(...slices.map(s => s.startTime)),
            end: Math.max(...slices.map(s => s.endTime))
        };
        lines.push(`| Time Range | ${TraceParser.formatTimestamp(timeRange.start)} - ${TraceParser.formatTimestamp(timeRange.end)} |`);
        lines.push('');

        // Slices table
        lines.push('## Slices');
        lines.push('');
        lines.push('| # | Name | Track | Start | Duration | Category |');
        lines.push('|---|------|-------|-------|----------|----------|');
        
        slices.sort((a, b) => a.startTime - b.startTime).forEach((slice, idx) => {
            const track = this.getTrackForSlice(slice, tracks);
            lines.push(`| ${idx + 1} | ${slice.name} | ${track.name} | ${TraceParser.formatTimestamp(slice.startTime)} | ${TraceParser.formatDuration(slice.duration)} | ${slice.category || '-'} |`);
        });
        lines.push('');

        // Args section
        const slicesWithArgs = slices.filter(s => s.args && Object.keys(s.args).length > 0);
        if (slicesWithArgs.length > 0) {
            lines.push('## Slice Arguments');
            lines.push('');
            slicesWithArgs.forEach(slice => {
                lines.push(`### ${slice.name} (${TraceParser.formatTimestamp(slice.startTime)})`);
                lines.push('```json');
                lines.push(JSON.stringify(slice.args, null, 2));
                lines.push('```');
                lines.push('');
            });
        }

        // Statistics
        lines.push('## Statistics');
        lines.push('');
        const stats = this.calculateStats(slices);
        
        lines.push('### Duration Statistics');
        lines.push(`- Average: ${TraceParser.formatDuration(stats.avgDuration)}`);
        lines.push(`- Min: ${TraceParser.formatDuration(stats.minDuration)}`);
        lines.push(`- Max: ${TraceParser.formatDuration(stats.maxDuration)}`);
        lines.push('');
        
        lines.push('### Top Slices by Duration');
        stats.topByDuration.forEach((s, i) => {
            lines.push(`${i + 1}. **${s.name}** - ${TraceParser.formatDuration(s.duration)}`);
        });

        return lines.join('\n');
    }

    /**
     * Format to JSON - for programmatic use
     */
    toJSON(slices, tracks, viewInfo) {
        const timeRange = {
            start: Math.min(...slices.map(s => s.startTime)),
            end: Math.max(...slices.map(s => s.endTime))
        };

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
     * Format as analysis prompt - ready to paste into LLM
     */
    toAnalysisPrompt(slices, tracks, viewInfo) {
        const lines = [];
        
        lines.push('I have a performance trace from an application. Please analyze the following trace data and provide insights:');
        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push('## Trace Context');
        lines.push('This trace captures execution events (called "slices") from different threads/processes.');
        lines.push('Each slice has a name, start time, duration, and associated thread/process.');
        lines.push('');
        
        // Summary
        const totalDuration = slices.reduce((sum, s) => sum + s.duration, 0);
        const timeRange = {
            start: Math.min(...slices.map(s => s.startTime)),
            end: Math.max(...slices.map(s => s.endTime))
        };
        
        lines.push('## Summary');
        lines.push(`- Total Slices Analyzed: ${slices.length}`);
        lines.push(`- Time Span: ${TraceParser.formatDuration(timeRange.end - timeRange.start)}`);
        lines.push(`- Total Execution Time: ${TraceParser.formatDuration(totalDuration)}`);
        lines.push('');

        // Group by track
        const byTrack = this.groupByTrack(slices, tracks);
        
        lines.push('## Execution Timeline');
        lines.push('');
        
        Object.entries(byTrack).forEach(([trackName, trackSlices]) => {
            lines.push(`### Thread: ${trackName}`);
            
            trackSlices.sort((a, b) => a.startTime - b.startTime);
            
            trackSlices.forEach(slice => {
                const relativeStart = TraceParser.formatTimestamp(slice.startTime - timeRange.start);
                lines.push(`- [${relativeStart}] **${slice.name}** (${TraceParser.formatDuration(slice.duration)})`);
                
                if (slice.args && Object.keys(slice.args).length > 0) {
                    lines.push(`  - Arguments: \`${JSON.stringify(slice.args)}\``);
                }
            });
            lines.push('');
        });

        // Statistics
        const stats = this.calculateStats(slices);
        
        lines.push('## Performance Metrics');
        lines.push('');
        lines.push('### Duration Distribution');
        lines.push(`- Average: ${TraceParser.formatDuration(stats.avgDuration)}`);
        lines.push(`- Min: ${TraceParser.formatDuration(stats.minDuration)}`);
        lines.push(`- Max: ${TraceParser.formatDuration(stats.maxDuration)}`);
        lines.push('');
        
        lines.push('### Hotspots (Top 5 by Duration)');
        stats.topByDuration.forEach((s, i) => {
            const track = this.getTrackForSlice(s, tracks);
            lines.push(`${i + 1}. **${s.name}** in ${track.name} - ${TraceParser.formatDuration(s.duration)}`);
        });
        lines.push('');
        
        lines.push('### Frequency Analysis');
        Object.entries(stats.nameFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .forEach(([name, count]) => {
                lines.push(`- ${name}: ${count} occurrences`);
            });
        lines.push('');
        
        lines.push('---');
        lines.push('');
        lines.push('## Questions for Analysis');
        lines.push('');
        lines.push('Please analyze this trace data and answer:');
        lines.push('');
        lines.push('1. **Performance Bottlenecks**: What are the main performance bottlenecks visible in this trace?');
        lines.push('');
        lines.push('2. **Optimization Opportunities**: What optimizations would you suggest based on the execution patterns?');
        lines.push('');
        lines.push('3. **Anomalies**: Are there any unusual patterns or potential issues in the trace?');
        lines.push('');
        lines.push('4. **Thread Utilization**: How well is the work distributed across threads?');
        lines.push('');
        lines.push('5. **Recommendations**: What specific changes would improve the performance of this code?');

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

        return {
            uniqueNames,
            avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
            minDuration: Math.min(...durations),
            maxDuration: Math.max(...durations),
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
