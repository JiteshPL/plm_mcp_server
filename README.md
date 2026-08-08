# PLM MCP Server

A lightweight server and browser UI for interactive multi-command planning (MCP) with a Three.js preview UI.

![Architecture diagram](docs/architecture.svg)

## Overview

This repository contains a small HTTP/WebSocket server implementing MCP command logic, a LangGraph-based command workflow, and a standalone Three.js browser interface for visual previews and user clarification.

## Recent changes

- Added an architecture diagram and documentation to clarify component responsibilities.
- Clarified startup and UI instructions in README.
- Rearranged the README file structure for easier onboarding.

> If you'd like the README to include a changelog containing commit-level details, I can add that too (I didn't generate a changelog from commits to avoid guessing commit messages).

## Architecture

The high-level components are:

- UI (ui/): Three.js scene, chat and clarification controls, and styles. Runs in the browser and connects to the server over WebSocket.
- Server (server/ and server.js): Entry point and backward-compatible launcher, hosts MCP, HTTP/WebSocket endpoints, LangGraph command workflow, intent parsing, and tools.
- Browser bridge (browser-bridge.js): WebSocket bridging utilities for the UI to communicate with the MCP runtime.
- LangGraph / command graph (command-graph.js): Command workflow and orchestration logic.
- Intent and tools (intent.js, tools.js): Clarification / fallback intent parsing and tool definitions used by MCP.

Refer to the diagram above for component relationships and message flow.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open the UI in your browser:

- Open `ui/index.html` in a browser (or serve the `ui/` folder if your browser blocks local file websocket connections).

## File layout

```
server/                 MCP, HTTP/WebSocket, LangGraph, and command logic
  index.js              Server entry point
  command-graph.js      LangGraph command workflow
  intent.js             Clarification and fallback intent parsing
  tools.js              MCP tool definitions
  browser-bridge.js     Browser WebSocket bridge
  config.js             Runtime configuration
ui/                     Standalone Three.js browser interface
  index.html            UI entry point
  app.js                Three.js scene and browser tool handlers
  chat-ui.js            Chat and clarification controls
  styles.css            UI styles
server.js               Backward-compatible launcher
```

## Contributing

Open an issue or PR for proposed changes. If you'd like, I can also add a generated changelog, or split the architecture diagram into separate PNG/SVG versions.
