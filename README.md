# Perfetto Trace Viewer with LLM Export

A web-based Perfetto trace viewer that allows you to visualize, navigate, and export trace data in LLM-friendly formats.

## Features

### Trace Viewing
- 📂 **Load Traces**: Support for Perfetto JSON traces, Chrome trace format, and systrace format
- 🔍 **Zoom & Pan**: Mouse wheel to zoom, drag to pan across the timeline
- 📊 **Track-based Visualization**: Slices organized by process/thread tracks
- 🎨 **Color-coded Slices**: Consistent coloring based on slice name/category

### Interaction
- **Click** on a slice to see detailed information
- **Shift + Drag** to select multiple slices in a region
- **Ctrl/Cmd + Click** to add/remove slices from selection
- **Double-click** to zoom into a specific slice
- **Ctrl/Cmd + A** to select all visible slices
- **Escape** to clear selection

### LLM Export
Convert selected trace data into formats optimized for LLM analysis:

1. **Structured Text**: Clean, parseable format with clear sections
2. **Markdown**: Well-formatted documentation style
3. **JSON**: Machine-readable structured data
4. **Analysis Prompt**: Ready-to-use prompt with questions for the LLM

## Quick Start

### Option 1: Simple HTTP Server (Python)
```bash
cd perfetto-to-llm
python3 -m http.server 8080
```
Then open http://localhost:8080 in your browser.

### Option 2: Using Node.js
```bash
npx serve .
```

### Option 3: VS Code Live Server
If you have the Live Server extension, right-click `index.html` and select "Open with Live Server".

## Usage

1. **Load a Trace**:
   - Click "Load Trace" to select a Perfetto trace file
   - Or click "Load Demo Trace" to see sample data

2. **Navigate the Trace**:
   - Scroll mouse wheel to zoom in/out
   - Click and drag to pan left/right
   - Use the zoom buttons for precise control

3. **Select Slices**:
   - Click on any slice to select it and see details
   - Hold Shift and drag to select multiple slices
   - Hold Ctrl/Cmd and click to toggle individual slices

4. **Export for LLM**:
   - Click "Copy for LLM" button
   - Choose your preferred export format
   - Click "Copy" to copy to clipboard
   - Paste into your favorite LLM (ChatGPT, Claude, etc.)

## Supported Trace Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Chrome Trace | `.json` | Standard Chrome DevTools trace format |
| Perfetto JSON | `.json` | Exported from Perfetto UI |
| Systrace | `.systrace`, `.html` | Android systrace format |
| Binary Perfetto | `.perfetto-trace`, `.pb` | Requires conversion* |

*Binary Perfetto traces should be converted to JSON using the Perfetto UI or trace_processor.

## Export Formats Explained

### Structured Text
Best for general LLM queries. Clear hierarchical format:
```
## SLICES BY TRACK
### Main Thread
[1] performLayout
    Start: 10.50 ms
    Duration: 2.30 ms
```

### Markdown
Great for documentation or sharing:
```markdown
| # | Name | Track | Duration |
|---|------|-------|----------|
| 1 | performLayout | Main Thread | 2.30 ms |
```

### JSON
For programmatic analysis:
```json
{
  "slices": [...],
  "statistics": {...}
}
```

### Analysis Prompt
Complete prompt with context and questions:
```
Please analyze this trace data and answer:
1. What are the main performance bottlenecks?
2. What optimizations would you suggest?
...
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Scroll Wheel` | Zoom in/out |
| `Shift + Drag` | Select region |
| `Ctrl/Cmd + Click` | Toggle slice selection |
| `Ctrl/Cmd + A` | Select all visible |
| `Escape` | Clear selection / Close panels |
| `Ctrl/Cmd + C` | Copy LLM output (when panel open) |

## Browser Support

- Chrome/Edge 80+
- Firefox 75+
- Safari 13+

## Tips for LLM Analysis

1. **Be Specific**: Select only the relevant slices for your question
2. **Use Analysis Prompt**: The "Analysis Prompt" format includes helpful questions
3. **Include Context**: Add your own context before pasting the trace data
4. **Iterate**: Start with a small selection and expand as needed

## License

MIT License - Feel free to use and modify as needed.
