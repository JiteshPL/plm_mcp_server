import "dotenv/config"; // <--- Add this line
import http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const PORT = 8080;

const openai = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGINGFACE_API_KEY
});

const MODEL_NAME = process.env.HUGGINGFACE_REPO_ID || "Qwen/Qwen2.5-7B-Instruct";
const TEMPERATURE = parseFloat(process.env.HUGGINGFACE_TEMPERATURE || "0.2");
const MAX_NEW_TOKENS = parseInt(process.env.HUGGINGFACE_MAX_NEW_TOKENS || "512", 10);

const TOOL_DEFINITIONS = [
  {
    name: "reset_scene",
    description: "Restores the 3D scene to its initial camera view, component positions, colors, visibility, and clipping state.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "highlight_components",
    description: "Highlights target CAD components by filter criteria (e.g., supplier/vendor) in color and optionally isolates them.",
    inputSchema: {
      type: "object",
      properties: {
        filterCriteria: {
          type: "object",
          properties: { supplier: { type: "string", description: "Target vendor like Vendor-A, Vendor-B, Vendor-C" } }
        },
        colorHex: { type: "string", description: "Hex color value starting with # e.g. #ff0000" },
        isolateMode: { type: "boolean", description: "If true, hides non-matching components." }
      },
      required: ["colorHex"]
    }
  },
  {
    name: "set_camera_view",
    description: "Repositions camera view in 3D canvas (Isometric, Top, Bottom, Front, Right).",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["Isometric", "Top", "Bottom", "Front", "Right"] }
      },
      required: ["preset"]
    }
  },
  {
    name: "generate_exploded_view",
    description: "Explodes or collapses components in the 3D assembly outward from center.",
    inputSchema: {
      type: "object",
      properties: {
        explosionFactor: { type: "number", description: "Distance multiplier (0.0 to 2.0). 0 resets to original position." }
      },
      required: ["explosionFactor"]
    }
  },
  {
    name: "create_cross_section",
    description: "Applies dynamic cutting plane across 3D model to inspect interior geometry.",
    inputSchema: {
      type: "object",
      properties: {
        plane: { type: "string", enum: ["XY", "YZ", "ZX"] },
        offsetDistance: { type: "number", description: "Offset plane distance along normal axis." },
        enabled: { type: "boolean", description: "Toggle cross section cutting on/off." }
      },
      required: ["plane", "enabled"]
    }
  }
];

const COLOR_OPTIONS = [
  ["Blue", "#0084ff"], ["Red", "#ff0000"], ["Green", "#00c853"],
  ["Yellow", "#ffd600"], ["Orange", "#ff6d00"], ["Purple", "#9c27b0"]
];

function getClarification(text) {
  const lower = text.toLowerCase();
  const hasColor = /#[0-9a-f]{3,8}\b/i.test(text) || COLOR_OPTIONS.some(([color]) => lower.includes(color.toLowerCase()));
  const asksToHighlight = lower.includes("highlight") || lower.includes("vendor") || lower.includes("supplier");
  const hasSupplier = /\bvendor[\s-]?[abc]\b/i.test(text);
  if (asksToHighlight && !hasSupplier) {
    return {
      reply: "Which vendor's parts should I highlight?",
      choices: ["Vendor-A", "Vendor-B", "Vendor-C"].map(vendor => ({ label: vendor, message: `Highlight ${vendor} parts` }))
    };
  }
  if (asksToHighlight && !hasColor) {
    return {
      reply: "Which highlight color would you like?",
      // Include the exact hex value so color names such as Orange never need
      // to be interpreted by the LLM.
      choices: COLOR_OPTIONS.map(([label, hex]) => ({ label, message: `${text} with color ${hex}` }))
    };
  }

  const asksToExplode = lower.includes("explode");
  const hasExplosionFactor = /\b(?:by|factor|to)\s*(?:of\s*)?[0-2](?:\.\d+)?\b/i.test(lower);
  if (asksToExplode && !hasExplosionFactor) {
    return {
      reply: "How far should I explode the assembly?",
      choices: [0, 0.5, 1, 1.5, 2].map(factor => ({ label: `Factor ${factor}`, message: `Explode assembly by ${factor}` }))
    };
  }

  const asksForSection = lower.includes("cross section") || lower.includes("slice") || lower.includes("cut");
  const sectionPlanes = ["XY", "YZ", "ZX"];
  const selectedPlane = sectionPlanes.find(plane => new RegExp(`\\b${plane.toLowerCase()}\\b`, "i").test(lower));
  if (asksForSection && !selectedPlane) {
    return {
      reply: "Which cross-section plane should I use?",
      choices: sectionPlanes.map(plane => ({ label: plane, message: `Create a ${plane} cross section` }))
    };
  }
  const hasOffset = /\boffset\s*(?:of|to|at)?\s*-?\d+(?:\.\d+)?/i.test(lower);
  if (asksForSection && !hasOffset) {
    return {
      reply: "What section offset should I use?",
      choices: [-2, -1, 0, 1, 2].map(offset => ({ label: `Offset ${offset}`, message: `Create a ${selectedPlane} cross section at offset ${offset}` }))
    };
  }

  const viewNames = ["isometric", "top", "bottom", "front", "right"];
  const asksForView = /\b(view|camera)\b/.test(lower);
  if (asksForView && !asksToExplode && !viewNames.some(view => lower.includes(view))) {
    return {
      reply: "Which camera view would you like?",
      choices: viewNames.map(view => ({ label: view[0].toUpperCase() + view.slice(1), message: `Set view to ${view}` }))
    };
  }

  return null;
}

function isResetRequest(text) {
  const lower = text.toLowerCase();
  return /\breset\b/.test(lower)
    || /\b(default|initial)\s+(view|scene)\b/.test(lower)
    || /\b(return|restore)\b.*\b(default|initial)\b/.test(lower);
}

// Fallback Keyword Matcher (Works instantly without external API/LLM)
function parseLocalIntent(text) {
  const lower = text.toLowerCase();
  if (isResetRequest(text)) return [{ name: "reset_scene", args: {} }];
  const actions = [];
  
  if (lower.includes("explode")) {
    const factorMatch = lower.match(/\b([0-2](\.\d+)?)\b/);
    const factor = factorMatch ? parseFloat(factorMatch[1]) : 1.2;
    actions.push({ name: "generate_exploded_view", args: { explosionFactor: factor } });
  }
  
  if (lower.includes("isometric") || lower.includes("top") || lower.includes("bottom") || lower.includes("front") || lower.includes("right")) {
    let preset = "Isometric";
    if (lower.includes("top")) preset = "Top";
    if (lower.includes("bottom")) preset = "Bottom";
    if (lower.includes("front")) preset = "Front";
    if (lower.includes("right")) preset = "Right";
    actions.push({ name: "set_camera_view", args: { preset } });
  }

  if (lower.includes("vendor") || lower.includes("highlight")) {
    let supplier = "Vendor-A";
    if (lower.includes("vendor-b") || lower.includes("vendor b")) supplier = "Vendor-B";
    if (lower.includes("vendor-c") || lower.includes("vendor c")) supplier = "Vendor-C";
    
    const selectedColor = COLOR_OPTIONS.find(([color]) => lower.includes(color.toLowerCase()));
    const colorHex = selectedColor?.[1];

    if (!colorHex) return null;

    actions.push({ name: "highlight_components", args: { filterCriteria: { supplier }, colorHex, isolateMode: false } });
  }

  if (lower.includes("cross section") || lower.includes("slice") || lower.includes("cut")) {
    let plane = "ZX";
    if (lower.includes("xy")) plane = "XY";
    if (lower.includes("yz")) plane = "YZ";
    const offsetMatch = lower.match(/\boffset\s*(?:of|to|at)?\s*(-?\d+(?:\.\d+)?)/i);
    const offsetDistance = offsetMatch ? parseFloat(offsetMatch[1]) : 0;
    actions.push({ name: "create_cross_section", args: { plane, offsetDistance, enabled: true } });
  }

  return actions.length > 0 ? actions : null;
}

// -------------------------------------------------------------
// HTTP & WebSocket Server Setup
// -------------------------------------------------------------
let browserSocket = null;

function sendActionsToBrowser(actions) {
  // One frame makes a multi-tool command atomic at the protocol boundary. The
  // client processes this array in order, so a later tool cannot replace a
  // pending earlier WebSocket message.
  browserSocket.send(JSON.stringify({ actions }));
}

// LangGraph state and nodes for one chat command. The graph keeps command
// selection explicit and makes it straightforward to add approvals or retries.
const CommandState = Annotation.Root({
  message: Annotation,
  history: Annotation({ default: () => [] }),
  clarification: Annotation({ default: () => null }),
  executedTools: Annotation({ default: () => [] }),
  reply: Annotation({ default: () => "" }),
  llmFailed: Annotation({ default: () => false })
});

function clarifyCommand(state) {
  return { clarification: getClarification(state.message) };
}

function detectReset(state) {
  return isResetRequest(state.message)
    ? { executedTools: [{ name: "reset_scene", args: {} }], reply: "Scene and camera reset to the initial view." }
    : {};
}

function routeAfterReset(state) {
  return Array.isArray(state.executedTools) && state.executedTools.length > 0
    ? "dispatch"
    : "clarify";
}

function routeAfterClarification(state) {
  return state.clarification ? END : "plan_llm";
}

async function planWithLlm(state) {
  try {
    const tools = TOOL_DEFINITIONS.map(tool => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
    }));
    const response = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: "You are an AI CAD assistant. Use tool calls to control the 3D canvas. Never guess a highlight color, camera preset, section offset, or explosion factor: ask the user to choose when any is missing." },
        ...state.history,
        { role: "user", content: state.message }
      ],
      tools,
      tool_choice: "auto",
      temperature: TEMPERATURE,
      max_tokens: MAX_NEW_TOKENS
    });
    const responseMessage = response.choices[0].message;
    const executedTools = (responseMessage.tool_calls || []).map(toolCall => ({
      name: toolCall.function.name,
      args: typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments
    }));
    return {
      executedTools,
      reply: responseMessage.content || (executedTools.length > 0 ? `Executed action: ${executedTools.map(tool => tool.name).join(", ")}` : "Command received, but no matching 3D action found."),
      llmFailed: false
    };
  } catch (error) {
    console.warn("[LangGraph: plan_llm] LLM planning failed; routing to fallback.", error.message);
    return { llmFailed: true };
  }
}

function routeAfterPlanning(state) {
  return state.llmFailed ? "fallback" : "dispatch";
}

function fallbackPlan(state) {
  const executedTools = parseLocalIntent(state.message);
  return executedTools
    ? { executedTools, reply: `Executed action: ${executedTools.map(action => action.name).join(", ")}` }
    : { executedTools: [], reply: "Command received, but no matching 3D action found." };
}

function dispatchActions(state) {
  if (state.executedTools.length === 0) return {};
  if (!browserSocket || browserSocket.readyState !== 1) {
    console.error("[Server Error] Cannot execute action: No active WebSocket browser connection!");
    return { reply: `${state.reply} (Warning: 3D Browser View is not connected over WebSocket)` };
  }
  console.log(`[LangGraph: dispatch] Sending ${state.executedTools.length} action(s): ${state.executedTools.map(tool => tool.name).join(", ")}`);
  sendActionsToBrowser(state.executedTools);
  return {};
}

const commandGraph = new StateGraph(CommandState)
  .addNode("detect_reset", detectReset)
  .addNode("clarify", clarifyCommand)
  .addNode("plan_llm", planWithLlm)
  .addNode("fallback", fallbackPlan)
  .addNode("dispatch", dispatchActions)
  .addEdge(START, "detect_reset")
  .addConditionalEdges("detect_reset", routeAfterReset, ["dispatch", "clarify"])
  .addConditionalEdges("clarify", routeAfterClarification, ["plan_llm", END])
  .addConditionalEdges("plan_llm", routeAfterPlanning, ["fallback", "dispatch"])
  .addEdge("fallback", "dispatch")
  .addEdge("dispatch", END)
  .compile();

const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { message, history = [] } = JSON.parse(body);
        console.log(`[Server] Received user prompt: "${message}"`);

        const result = await commandGraph.invoke({ message, history });

        res.writeHead(200, { "Content-Type": "application/json" });
        if (result.clarification) {
          res.end(JSON.stringify({ ...result.clarification, executedTools: [] }));
        } else {
          res.end(JSON.stringify({ reply: result.reply, executedTools: result.executedTools }));
        }

      } catch (err) {
        console.error("API Error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  browserSocket = ws;
  console.log(`[MCP Server] Browser client connected on port ${PORT}`);
});

httpServer.listen(PORT, () => {
  console.log(`[Server] HTTP & WebSocket running on http://localhost:${PORT}`);
});

const server = new Server(
  { name: "threejs-plm-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!browserSocket || browserSocket.readyState !== 1) {
    return { isError: true, content: [{ type: "text", text: "Error: No active browser connection." }] };
  }
  sendActionsToBrowser([{ name, args }]);
  return { content: [{ type: "text", text: `Executed ${name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => { wss.close(); process.exit(0); });
process.on("SIGTERM", () => { wss.close(); process.exit(0); });
