# Perfetto Trace Viewer with LLM Export

A modern web-based viewer for Perfetto traces, designed for fast visualization, interactive analysis, and seamless export to formats optimized for large language models (LLMs).

## Features

- **Trace Loading**: Supports Perfetto JSON, Chrome trace, and systrace formats
- **Zoom & Pan**: Intuitive mouse and button controls
- **Track-based Visualization**: Slices organized by process/thread
- **Color-coded Slices**: Distinct colors for easy identification
- **Slice Selection**: Click, shift-drag, or multi-select with Ctrl/Cmd
- **LLM Export**: Structured text, Markdown, JSON, and analysis prompt formats
- **Copy to Clipboard**: One-click copy for LLM workflows

## Quick Start

### Option 1: Python HTTP Server
```bash
cd perfetto-to-llm
python3 -m http.server 8080
```
Open http://localhost:8080 in your browser.

### Option 2: Node.js
```bash
npx serve .
```

### Option 3: VS Code Live Server
Use the Live Server extension to open `index.html`.

## Usage

1. **Load a Trace**: Click "Load Trace" or "Load Demo Trace".
2. **Navigate**: Zoom with mouse wheel or buttons, pan by dragging.
3. **Select Slices**: Click to select, shift-drag for region, Ctrl/Cmd-click for multi-select.
4. **Export for LLM**: Use the "Copy for LLM" button, choose format, and copy to clipboard.

## Supported Trace Formats

| Format         | Extension                | Notes                                 |
|---------------|--------------------------|---------------------------------------|
| Chrome Trace  | `.json`                  | Chrome DevTools trace format           |
| Perfetto JSON | `.json`                  | Exported from Perfetto UI              |
| Systrace      | `.systrace`, `.html`     | Android systrace format                |
| Binary Perfetto | `.perfetto-trace`, `.pb`| Convert to JSON using Perfetto tools   |

## Export Formats

- **Structured Text**: Hierarchical, readable format for LLMs
- **Markdown**: Table format for documentation
- **JSON**: Machine-readable for programmatic analysis
- **Analysis Prompt**: Includes context and suggested questions

## Keyboard Shortcuts

| Shortcut           | Action                        |
|--------------------|------------------------------|
| Scroll Wheel       | Zoom in/out                   |
| Shift + Drag       | Select region                 |
| Ctrl/Cmd + Click   | Toggle slice selection        |
| Ctrl/Cmd + A       | Select all visible            |
| Escape             | Clear selection / Close panels|
| Ctrl/Cmd + C       | Copy LLM output (panel open)  |

## Tips for LLM Analysis

- Select only relevant slices for focused questions
- Use the "Analysis Prompt" format for guided analysis
- Add your own context before pasting to an LLM
- Start with a small selection and expand as needed

## License

MIT License. See [LICENSE](LICENSE) for details.
