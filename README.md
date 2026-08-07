# PLM MCP Server — 3D PLM Viewer + AI Copilot

A minimal, self-contained prototype that connects a web-based Three.js PLM viewer to an AI "copilot" backend. The Node server accepts natural-language commands, routes them to an LLM (via an OpenAI-compatible client + Hugging Face router), and translates LLM tool-calls into deterministic 3D actions sent to the browser over WebSocket. A local fallback parser provides instant keyword-to-action behavior when the LLM is unavailable.

## Stack
- Language(s): JavaScript (Node.js + browser)
- Runtime / Frameworks:
  - Node.js (ES modules) server
  - Three.js (r128) for client-side 3D rendering
- Notable libraries:
  - @modelcontextprotocol/sdk — exposes MCP-style RPC (ListTools / CallTool) from the server
  - openai npm client (used with Hugging Face router endpoint)
  - ws — WebSocket server
  - GLTFLoader (Three.js example) — loads the demo GLB model

## What this is
A small reference implementation demonstrating how an LLM-driven assistant can control a 3D PLM viewer through a small set of typed "tools". It is intended as a prototype for voice/NLP driven CAD/PLM interactions and as a testbed for tool orchestration patterns.

---

## High-level architecture

ASCII overview:

Browser (index.html + app.js + chat-ui)
  - Three.js scene, partsRegistry, UI quick actions
  - Exposes window.mcp_* functions that implement the tool effects
  - WebSocket client -> ws://localhost:8080
      ⇅
Node Server (server.js)
  - HTTP API: POST /api/chat
  - WebSocketServer (ws) used to deliver action messages to the browser
  - LLM integration (OpenAI client pointed at Hugging Face router)
  - MCP (modelcontextprotocol) Server exposed via Stdio transport (ListTools/CallTool)
  - Local fallback parser for quick keyword actions

Request / data flow (typical):
1. User types a command in the browser UI (or clicks a quick option).
2. Browser sends the user message to the Node server via `POST /api/chat`.
3. Node server forwards message + conversation history to the LLM with the configured `tools` schema.
4. LLM returns either plain text or one or more `tool_calls` (function name + typed arguments).
5. Node server parses tool_calls (or uses the local fallback parser) and constructs `executedTools`.
6. For each executed tool, server sends a WebSocket message to the connected browser: `{ action: "<tool_name>", payload: { ... } }`.
7. Browser receives the message and invokes the corresponding `window.mcp_<tool>` function (e.g., `window.mcp_highlight_components`) to update the Three.js scene.

---

## Repository layout (top-level)
- server.js        — Node server: HTTP /api/chat, WebSocketServer, LLM integration, MCP handlers
- package.json     — project manifest & dependencies
- index.html       — browser UI shell and layout
- app.js           — Three.js scene, client-side tool implementations, WebSocket bridge
- styles.css       — client CSS (referenced by index.html)
- chat-ui.js       — chat UI glue (referenced by index.html)
- (other small files) — assets, static styles or helper scripts

How it fits together: server.js is the central orchestrator for user commands; it talks to the LLM and to the browser. The browser runs the 3D view and performs visual changes in response to deterministic actions.

---

## Tool definitions (exposed by the server)
The server defines a small set of typed tools. These schemas are provided to the LLM so it can return typed tool-calls:

1. highlight_components
   - Description: Highlights target CAD components by filter criteria (supplier/vendor) in a color and optionally isolates them.
   - Input: { filterCriteria: { supplier: string }, colorHex: string, isolateMode: boolean }
2. set_camera_view
   - Description: Repositions camera view in 3D canvas (Isometric, Top, Front, Right).
   - Input: { preset: "Isometric" | "Top" | "Front" | "Right" }
3. generate_exploded_view
   - Description: Explodes or collapses components in the 3D assembly from center.
   - Input: { explosionFactor: number } (0.0 resets)
4. create_cross_section
   - Description: Applies a dynamic cutting plane to inspect internal geometry.
   - Input: { plane: "XY" | "YZ" | "ZX", offsetDistance: number, enabled: boolean }

These are declared in `server.js` under `TOOL_DEFINITIONS`. The same action names are handled in `app.js` as `window.mcp_*` functions.

---

## Server: key implementation notes (server.js)
- Exposes POST /api/chat (CORS allowed).
  - Request body: { message: string, history?: Array<{role, content}> }
  - Server attempts to call the LLM with the `tools` parameter (tools derived from TOOL_DEFINITIONS).
  - If the LLM returns `tool_calls`, the server parses them and sets executedTools.
  - If the LLM call fails or returns nothing actionable, server runs `parseLocalIntent` (a fast keyword-based fallback).
  - Response: `{ reply: string, executedTools: Array<{name, args}> }`.
- WebSocket management:
  - A single `browserSocket` reference is set when the browser connects. The server sends action messages to that socket. If no socket is connected, the server includes a warning in the reply.
- LLM client:
  - Uses the `openai` library but points `baseURL` to the Hugging Face router endpoint by default.
  - Configured via environment variables (see "Environment" below).
- ModelContextProtocol:
  - The server instantiates a Server from `@modelcontextprotocol/sdk`, registers handlers for ListToolsRequestSchema and CallToolRequestSchema and connects via `StdioServerTransport()`. This is a secondary integration point for other MCP-capable agents.

---

## Client: key implementation notes (app.js + index.html)
- Three.js scene setup: camera, lights, renderer, controls.
- Loads a sample GLB model (currently a public demo model) via `GLTFLoader`.
- Builds a parts registry (`partsRegistry`) where each mesh stores:
  - userData: { partId, supplier, originalColor, initialPosition }
- Vendor mapping: `vendorMap` and `assignSupplier()` map part names to vendor/supplier labels (Vendor-A / Vendor-B / Vendor-C). This is used by highlight logic.
- Implemented `window.mcp_*` functions:
  - `window.mcp_highlight_components(args)` — colors matching parts and optionally hides non-matching parts if `isolateMode` is true.
  - `window.mcp_set_camera_view(args)` — repositions camera for presets (Top, Front, Right, Isometric).
  - `window.mcp_generate_exploded_view(args)` — offsets part positions by a factor to create exploded views.
  - `window.mcp_create_cross_section(args)` — sets clippingPlanes for materials to create cross-section visuals.
- WebSocket bridge:
  - Connects to `ws://localhost:8080`.
  - On message, JSON-parses `{ action, payload }` and dispatches to the corresponding `window.mcp_<action>`.

---

## HTTP API (developer-facing)
POST /api/chat
- Body (JSON): { "message": "Highlight Vendor-B components in red", "history": [ /* optional chat history */ ] }
- Example:
  ```bash
  curl -X POST http://localhost:8080/api/chat \
    -H "Content-Type: application/json" \
    -d '{"message":"Explode assembly by 1.2","history":[] }'
  ```
- Example response:
  ```json
  {
    "reply": "Executed action: generate_exploded_view",
    "executedTools": [
      { "name": "generate_exploded_view", "args": { "explosionFactor": 1.2 } }
    ]
  }
  ```

WebSocket message format (server -> browser)
- JSON shape: { "action": "<tool_name>", "payload": { ... } }
- Example:
  ```json
  { "action": "highlight_components", "payload": { "filterCriteria": {"supplier":"Vendor-B"}, "colorHex":"#ff0000", "isolateMode": false } }
  ```

---

## Environment variables
- HUGGINGFACEHUB_API_TOKEN or HUGGINGFACE_API_KEY — API key for the Hugging Face router (used by OpenAI client `apiKey` configuration).
- HUGGINGFACE_REPO_ID — model identifier (default: `"Qwen/Qwen2.5-7B-Instruct"`)
- HUGGINGFACE_TEMPERATURE — e.g. "0.2"
- HUGGINGFACE_MAX_NEW_TOKENS — e.g. "512"
- PORT — server port (defaults to 8080 in code)

The code reads these variables in `server.js` and uses sensible defaults when missing. If no valid key is present, the LLM call will fail and the server will fall back to `parseLocalIntent()`.

---

## How to run (shortest path)
1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```
   Server listens on port 8080 by default.
3. Serve the static client files (recommended) from the repo root. Using a tiny static server:
   ```bash
   npx serve .  # or: python -m http.server 8000
   ```
4. Open the browser at the static server URL (e.g. http://localhost:5000/index.html) and ensure the Node server is running. The client will connect to ws://localhost:8080 automatically.

Note: Opening index.html directly from the file system (file:///) can work but using a local HTTP server avoids potential CORS/file protocol oddities.

---

## Extending the system
To add a new action/tool:
1. Add a new entry to `TOOL_DEFINITIONS` in `server.js` with a typed `inputSchema`.
2. Add a corresponding `window.mcp_<tool_name>` function in `app.js` to implement the client-side effect.
3. Optionally add a UI quick-action button to `index.html` that calls the client `sendQuickAction()` helper.

To change the LLM integration:
- Update `MODEL_NAME` or the base URL / credentials in `server.js`. The server constructs a `tools` array that is passed to the LLM client so the model knows the available functions.

---

## Troubleshooting
- "No active WebSocket browser connection": The server will still accept the command but cannot send actions to the browser. Ensure the client is loaded and connected to ws://localhost:8080.
- LLM errors or timeouts: The server uses `parseLocalIntent()` as a lightweight fallback. Check environment variables and model endpoint accessibility.
- Parts not highlighting: The vendor mapping is string-based on part names. For custom models with meaningful part names, extend `vendorMap` in `app.js`.
- Stdio transport (MCP) is configured at server startup. If you run other agents that use the Model Context Protocol, verify the transport configuration.

---

## Development notes & ideas
- Replace fallback parser with a lightweight on-device NLU for better offline behavior.
- Add authentication and origin restrictions to the WebSocket for production usage.
- Add a queue or retry mechanism if the browser disconnects when the server attempts to send an action.
- Extend MCP handlers to persist or audit tool calls for analytics.
- Implement more sophisticated exploded-view and physics-based transforms.

---

## Contributing & License
This repository is a prototype/demo. If you want to contribute, open issues or pull requests with concrete feature proposals or bug fixes.

License: No license file included (add a LICENSE to declare terms).
