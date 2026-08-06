import http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";
import OpenAI from "openai";

const PORT = 8080;

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama"
});

const MODEL_NAME = "qwen2.5:3b";

const TOOL_DEFINITIONS = [
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
    description: "Repositions camera view in 3D canvas (Isometric, Top, Front, Right).",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["Isometric", "Top", "Front", "Right"] }
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

// Fallback Keyword Matcher (Works instantly without external API/LLM)
function parseLocalIntent(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes("explode")) {
    const factorMatch = lower.match(/\b([0-2](\.\d+)?)\b/);
    const factor = factorMatch ? parseFloat(factorMatch[1]) : 1.2;
    return [{ name: "generate_exploded_view", args: { explosionFactor: factor } }];
  }
  
  if (lower.includes("isometric") || lower.includes("top") || lower.includes("front") || lower.includes("right")) {
    let preset = "Isometric";
    if (lower.includes("top")) preset = "Top";
    if (lower.includes("front")) preset = "Front";
    if (lower.includes("right")) preset = "Right";
    return [{ name: "set_camera_view", args: { preset } }];
  }

  if (lower.includes("vendor") || lower.includes("highlight")) {
    let supplier = "Vendor-A";
    if (lower.includes("vendor-b") || lower.includes("vendor b")) supplier = "Vendor-B";
    if (lower.includes("vendor-c") || lower.includes("vendor c")) supplier = "Vendor-C";
    
    let colorHex = "#0084ff";
    if (lower.includes("blue")) colorHex = "#0084ff";
    if (lower.includes("red")) colorHex = "#ff0000";
    if (lower.includes("green")) colorHex = "#00ff00";

    return [{ name: "highlight_components", args: { filterCriteria: { supplier }, colorHex, isolateMode: false } }];
  }

  if (lower.includes("cross section") || lower.includes("slice") || lower.includes("cut")) {
    return [{ name: "create_cross_section", args: { plane: "ZX", offsetDistance: 0, enabled: true } }];
  }

  return null;
}

// -------------------------------------------------------------
// HTTP & WebSocket Server Setup
// -------------------------------------------------------------
let browserSocket = null;

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

        let executedTools = [];
        let reply = "";

        try {
          const tools = TOOL_DEFINITIONS.map(tool => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema
            }
          }));

          const response = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [
              { role: "system", content: "You are an AI CAD assistant. Use tool calls to control the 3D canvas." },
              ...history,
              { role: "user", content: message }
            ],
            tools: tools,
            tool_choice: "auto"
          });

          const responseMessage = response.choices[0].message;

          if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            for (const toolCall of responseMessage.tool_calls) {
              const actionName = toolCall.function.name;
              const args = typeof toolCall.function.arguments === "string"
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;

              executedTools.push({ name: actionName, args });
            }
            reply = responseMessage.content || `Executed action: ${executedTools.map(t => t.name).join(", ")}`;
          } else {
            reply = responseMessage.content;
          }
        } catch (llmErr) {
          // LLM fallback parser
          const fallbackActions = parseLocalIntent(message);
          if (fallbackActions) {
            executedTools = fallbackActions;
            reply = `Executed action: ${fallbackActions.map(a => a.name).join(", ")}`;
          } else {
            reply = "Command received, but no matching 3D action found.";
          }
        }

        // Broadcast to Browser over WebSocket
        if (executedTools.length > 0) {
          if (browserSocket && browserSocket.readyState === 1) {
            for (const tool of executedTools) {
              console.log(`[Server] Sending WebSocket action to Browser: ${tool.name}`, tool.args);
              browserSocket.send(JSON.stringify({ action: tool.name, payload: tool.args }));
            }
          } else {
            console.error("[Server Error] Cannot execute action: No active WebSocket browser connection!");
            reply += " (Warning: 3D Browser View is not connected over WebSocket)";
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply, executedTools }));

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
  browserSocket.send(JSON.stringify({ action: name, payload: args }));
  return { content: [{ type: "text", text: `Executed ${name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => { wss.close(); process.exit(0); });
process.on("SIGTERM", () => { wss.close(); process.exit(0); });