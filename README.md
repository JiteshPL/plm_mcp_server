# PLM MCP Server

A lightweight HTTP/WebSocket server and browser UI for interactive multi-command planning (MCP) with a Three.js preview.

Overview

This repository implements a small MCP runtime that accepts natural-language commands, plans actions using a LangGraph-based command workflow (optionally using an LLM), and sends executable 3D actions to a browser preview. The implementation focuses on deterministic local parsing first with a function-calling style LLM planning fallback.

What this does

- Accepts user commands (chat-style) over WebSocket or HTTP.
- Attempts local intent parsing first for fast, deterministic actions.
- Falls back to an LLM planning step (via the configured Hugging Face / OpenAI-compatible client) when explicit parsing doesn't match.
- Dispatches actions to the browser UI which applies them to a Three.js scene.
- Exposes a modelcontextprotocol-compatible server (stdio transport) so runtime tools can be discovered and invoked programmatically.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables (common options):

- HUGGINGFACEHUB_API_TOKEN or HUGGINGFACE_API_KEY — API key used to call the LLM router.
- HUGGINGFACE_REPO_ID — model id (defaults to `Qwen/Qwen2.5-7B-Instruct` when not set).
- HUGGINGFACE_TEMPERATURE — numeric temperature override (default 0.2).
- HUGGINGFACE_MAX_NEW_TOKENS — max new tokens for LLM completions (default 512).
- PORT — server HTTP/WebSocket port (default 8080).

3. Start the server:

```bash
npm start
# or
node server.js
```

4. Open the UI in your browser:

- Open `ui/index.html` directly in a browser. If your browser blocks local-file WebSocket connections, serve the `ui/` folder (for example `npx http-server ui`) and open the served page.

Server behavior and API

- HTTP API endpoint: POST /api/chat
  - Payload: { "message": "...", "history": [ ... ] }
  - Response: If the graph produced a clarification prompt, the server returns that clarification along with executedTools: [] (so the UI can ask follow-up questions). Otherwise the server returns { reply, executedTools } where executedTools is an array of actions sent to the browser.

- WebSocket: The server accepts a browser WebSocket connection and forwards executed tool actions to the connected browser preview. When dispatching actions, a warning is logged and included in the reply if the 3D browser view is not connected.

- modelcontextprotocol server: The runtime also launches a Model Context Protocol server (stdio transport). It implements ListTools and CallTool handlers so external controllers can list the available tools and invoke them programmatically.

Runtime configuration (defaults & env names)

- PORT — defaults to 8080
- DEBUG — currently enabled by default in config.js (set to `false` in code to disable console debug logs)
- MODEL_NAME — read from HUGGINGFACE_REPO_ID or defaults to `Qwen/Qwen2.5-7B-Instruct`
- TEMPERATURE — read from HUGGINGFACE_TEMPERATURE (default 0.2)
- MAX_NEW_TOKENS — read from HUGGINGFACE_MAX_NEW_TOKENS (default 512)

Command flow / LangGraph behavior

The command workflow implemented in `server/command-graph.js` follows this prioritized flow:

1. detect_reset — quick check for reset-like inputs (e.g., "reset scene", "reset camera"). If matched, returns a `reset_scene` action immediately.
2. clarify — if the message appears ambiguous, the graph sets a clarification payload so the UI can ask a follow-up question instead of executing actions.
3. plan_explicit / local parsing — parse and execute simple, deterministic intents locally (no LLM). This is the fast path for camera controls, resets, and small utilities.
4. plan_llm — if local parsing doesn't yield actions, call the configured LLM. The code builds a function-calling style tool list from `server/tools.js` (type: "function", function: { name, description, parameters }) and calls the model. The server expects `message.tool_calls` (function-calling output) or conventional assistant content. The produced tool calls are converted into executedTools.
5. fallback — if the LLM call errors or returns no tools, local parsing is attempted again as a fallback.
6. dispatch — if executedTools are present, they're sent to the browser UI over WebSocket. A reply string may be returned alongside the dispatched actions.

Important implementation notes

- LLM client: The OpenAI-compatible client is constructed with a Hugging Face router baseURL and picks the API key from either HUGGINGFACEHUB_API_TOKEN or HUGGINGFACE_API_KEY. That means you can route calls through Hugging Face's router or supply an OpenAI-compatible API key depending on environment.

- Function-calling / tool definitions: `server/tools.js` contains TOOL_DEFINITIONS; these are translated to function-style descriptors for the LLM so the model can return structured `tool_calls`. The code then maps those calls into the in-memory executedTools array and applies `applyActionSuggestions` to normalize/validate them.

- Tool renames / changes: Notable tool name changes in this version include `set_camera_view` (replaces earlier `set_camera` naming). Inspect `server/tools.js` for the latest tool names and input schemas.

- Dispatch warnings: If the browser WebSocket is not connected, dispatching will log and include a warning in the reply so UIs can surface the connectivity issue to users.

File layout (summary)

- server/
  - index.js — Server entry point (HTTP + WebSocket listeners, ModelContext Protocol server bindings)
  - command-graph.js — LangGraph-based command/workflow construction (detect_reset -> clarify -> plan_llm -> fallback -> dispatch)
  - intent.js — Local intent parsing and clarification helpers
  - tools.js — Definitions of browser-facing tools (names, input schemas)
  - browser-bridge.js — WebSocket bridge utilities to send actions to the browser
  - config.js — Runtime configuration (model name, temperature, token limits)
- ui/
  - index.html — UI entry page (Three.js canvas + chat controls)
  - app.js — Three.js scene setup and tool handlers
  - chat-ui.js — Chat UI and clarification controls
  - styles.css — UI styling
- server.js — Backward-compatible launcher
- docs/architecture.svg — Architecture diagram referenced above

Usage examples

Create the LangGraph command graph (server-side):

```js
// server/index.js (excerpt)
import { createCommandGraph } from "./server/command-graph.js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGINGFACE_API_KEY, baseURL: "https://router.huggingface.co/v1" });
const graph = createCommandGraph(openai);

// When you receive a user message, construct a minimal state object and run the graph.
const initialState = { message: "rotate the cube 45 degrees clockwise" };
// The StateGraph instance returned by createCommandGraph will be used to execute the nodes
// and produce a side effect (sending actions to the browser) and/or a reply string.
```

HTTP POST example (UI -> server)

```json
{
  "message": "Move the camera back and reset the scene"
}
```

Browser action format (server -> UI) — example action array sent over WebSocket:

```json
[
  { "name": "reset_scene", "args": {} },
  { "name": "set_camera_view", "args": { "preset": "Isometric" } }
]
```

Notes about the command-graph implementation

- The Node definitions in `server/command-graph.js` implement a short-circuit pipeline: local rules first, then LLM planning. This reduces reliance on the LLM for trivial or deterministic commands.
- TOOL_DEFINITIONS in `server/tools.js` are transformed into function-like descriptors when the LLM is called, enabling function-calling style outputs that map to the browser toolset.
- The graph logs when dispatching actions and warns when the browser preview is not connected.

Contributing

If you'd like improvements to this README (more code examples, a PNG export of the LangGraph diagram, or a runtime sequence diagram), open an issue or a PR. I can also generate a changelog or add step-by-step deploy instructions on request.

License

MIT
