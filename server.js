import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });
let browserSocket = null;

wss.on("connection", (ws) => {
  browserSocket = ws;
  console.error(`[MCP Server] Browser client connected on port ${PORT}`);
});

const server = new Server(
  { name: "threejs-plm-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register All Tools for the LLM / MCP Inspector
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "highlight_components",
        description: "Highlights target CAD components by filter criteria in color and optionally isolates them.",
        inputSchema: {
          type: "object",
          properties: {
            filterCriteria: {
              type: "object",
              properties: {
                supplier: { type: "string" }
              }
            },
            colorHex: { type: "string" },
            isolateMode: { type: "boolean" }
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
    ]
  };
});

// Route Tool Execution Requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!browserSocket || browserSocket.readyState !== 1) {
    return {
      isError: true,
      content: [{ type: "text", text: "Error: No active 3D WebGL viewer application connected on port 8080." }]
    };
  }

  // Broadcast command payload over WebSocket to HTML browser client
  browserSocket.send(JSON.stringify({
    action: name,
    payload: args
  }));

  return {
    content: [{ type: "text", text: `Successfully executed tool '${name}' with parameters: ${JSON.stringify(args)}` }]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);


// Add at the bottom of server.js to close socket clean up on exit
process.on("SIGINT", () => {
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  wss.close();
  process.exit(0);
});