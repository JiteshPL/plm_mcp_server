# PLM MCP Server

A lightweight HTTP/WebSocket server and browser UI for interactive multi-command planning (MCP) with a Three.js preview.

This project implements a small MCP runtime that accepts natural-language commands, plans actions using a LangGraph-based command workflow (local parsing first, then optional LLM planning), and dispatches executable 3D actions to a browser preview powered by Three.js.

Highlights

- Accept chat-style commands over HTTP or WebSocket
- Fast local intent parsing for common commands (camera controls, reset, presets)
- Structured LLM-based planning (function-calling/tool-calls) as a fallback
- Sends executable actions (tool invocations) to a browser preview
- Exposes a Model Context Protocol (stdio) server for programmatic tool discovery and invocation

Quick start

1. Install dependencies

```bash
npm install
```

2. Configure environment variables (common options)

- HUGGINGFACEHUB_API_TOKEN or HUGGINGFACE_API_KEY — API key used by the OpenAI-compatible client/router
- HUGGINGFACE_REPO_ID or MODEL_NAME — model id to use (defaults to `Qwen/Qwen2.5-7B-Instruct` if not set)
- HUGGINGFACE_TEMPERATURE or TEMPERATURE — numeric temperature override (default: 0.2)
- HUGGINGFACE_MAX_NEW_TOKENS or MAX_NEW_TOKENS — max new tokens for LLM completions (default: 512)
- PORT — server HTTP/WebSocket port (default: 8080)

3. Start the server

```bash
npm start
# or
node server.js
```

4. Open the UI

- Open `ui/index.html` directly in a browser, or serve the `ui/` folder (for example: `npx http-server ui`) if your browser blocks local-file WebSocket connections.

Server behavior and API

- HTTP API endpoint: POST /api/chat
  - Payload: { "message": "...", "history": [...] }
  - Response: JSON object containing either a `clarification` (if the graph asks a follow-up question) or `reply` and `executedTools`.

- WebSocket: Server accepts a browser WebSocket connection and forwards executed tool actions to the connected browser preview. When dispatching actions while the preview is not connected, a warning is included in the reply so the UI can surface connectivity issues.

- Model Context Protocol (stdio): A lightweight MCP-compatible server is launched alongside the HTTP server. It implements ListTools and CallTool handlers so external controllers can discover and invoke runtime tools programmatically.

Example: building and running the LangGraph-based command graph

```js
// server/index.js (excerpt)
import { createCommandGraph } from "./server/command-graph.js";
import OpenAI from "openai"; // OpenAI-compatible client (router)

const openai = new OpenAI({
  apiKey: process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGINGFACE_API_KEY,
  baseURL: "https://router.huggingface.co/v1",
});

const graph = createCommandGraph(openai);

// When you receive a user message, construct a minimal state object and run the graph.
const initialState = { message: "rotate the cube 45 degrees clockwise" };
// The StateGraph instance returned by createCommandGraph will be used to execute the nodes
// and produce side effects (sending actions to the browser) and/or a reply string.
```

Browser action format (server -> UI) — example action array sent over WebSocket:

```json
[
  { "name": "reset_scene", "args": {} },
  { "name": "set_camera_view", "args": { "preset": "Isometric" } }
]
```

LangGraph node diagram

The command workflow implemented in server/command-graph.js follows a prioritized, short-circuit pipeline. The diagram below summarizes the main nodes and the decision flow (Mermaid):

```mermaid
flowchart TD
  A[Receive user message] --> B[detect_reset]
  B -- reset detected --> G[dispatch reset_scene]
  B -- no reset --> C[clarify?]
  C -- ambiguous --> H[return clarification]
  C -- clear --> D[plan_explicit / local parsing]
  D -- match (local) --> G
  D -- no match --> E[plan_llm]
  E --> F[LLM -> tool_calls]
  F --> G[dispatch executedTools]
  E -- error / no tools --> D[re-run local parsing as fallback]
  G --> I[send to browser preview (WebSocket)]
```

If you prefer a static SVG export of this node diagram, I can add docs/langgraph-nodes.svg to the repo.

Implementation notes

- Local parsing (server/intent.js) is the fast, deterministic path used for camera manipulations, resets, and other simple commands.
- LLM planning: TOOL_DEFINITIONS in `server/tools.js` are translated to function-style descriptors for the LLM so the model can return structured tool_calls. Those tool_calls are validated and mapped to browser actions before dispatch.
- Dispatching: Executed tools are sent to the browser preview via WebSocket. If the preview is not connected, the server returns the actions in the response and includes a dispatch warning.

Runtime configuration (defaults & env names)

- PORT — defaults to 8080
- DEBUG — set in config.js (set to `false` to suppress debug logs)
- MODEL_NAME / HUGGINGFACE_REPO_ID — defaults to `Qwen/Qwen2.5-7B-Instruct` in config
- TEMPERATURE / HUGGINGFACE_TEMPERATURE — default 0.2
- MAX_NEW_TOKENS / HUGGINGFACE_MAX_NEW_TOKENS — default 512

File layout

- server/
  - index.js — Server entry point (HTTP + WebSocket + Model Context Protocol bindings)
  - command-graph.js — LangGraph-based command/workflow construction (detect_reset -> clarify -> plan_llm -> fallback -> dispatch)
  - intent.js — Local intent parsing and clarification helpers
  - tools.js — Definitions of browser-facing tools (names, JSON input schemas)
  - browser-bridge.js — WebSocket bridge utilities to send actions to the browser
  - config.js — Runtime configuration (model name, temperature, token limits)
- ui/
  - index.html — UI entry page (Three.js canvas + chat controls)
  - app.js — Three.js scene setup and tool handlers
  - chat-ui.js — Chat UI and clarification controls
  - styles.css — UI styling
- server.js — Backward-compatible launcher
- docs/architecture.svg — Architecture diagram

Contributing

PRs and issues welcome. If you'd like me to:

- export the LangGraph node diagram as an SVG and add it to docs/
- add more code examples or a runtime sequence diagram
- improve the UI instructions or add Docker/startup scripts

... tell me which one and I'll add it.

License

MIT
