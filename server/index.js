import "dotenv/config";
import http from "http";
import OpenAI from "openai";
import {
  Server
} from "@modelcontextprotocol/sdk/server/index.js";
import {
  StdioServerTransport
} from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  DEBUG,
  PORT
} from "./config.js";
import {
  attachBrowserBridge,
  isBrowserConnected,
  sendActionsToBrowser
} from "./browser-bridge.js";
import {
  createCommandGraph
} from "./command-graph.js";
import {
  TOOL_DEFINITIONS
} from "./tools.js";

const openai = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGINGFACE_API_KEY
});
const commandGraph = createCommandGraph(openai);
const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.url !== "/api/chat" || req.method !== "POST") {
    res.writeHead(404);
    return res.end();
  }
  let body = "";
  req.on("data", chunk => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const {
        message,
        history = []
      } = JSON.parse(body);
      if (DEBUG) console.log(`[Server] Received user prompt: "${message}"`);
      if (DEBUG) console.log(`[Server] Request history length: ${history.length}`);
      const result = await commandGraph.invoke({
        message,
        history
      });
      if (DEBUG) console.log(`[Server] Graph result`, JSON.stringify(result, null, 2));
      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      const clarification = result.clarification;

      res.end(
        JSON.stringify(
          clarification
            ? {
                reply: "Please choose an option below.",
                choices: Array.isArray(clarification.choices)
                  ? clarification.choices
                  : [],
                executedTools: [],
              }
            : {
                reply: result.reply,
                executedTools: result.executedTools,
              },
        ),
      );
    } catch (error) {
      console.error("API Error:", error);
      res.writeHead(500, {
        "Content-Type": "application/json"
      });
      res.end(JSON.stringify({
        error: error.message
      }));
    }
  });
});
const wss = attachBrowserBridge(httpServer);

function startServer(port) {
  const onError = error => {
    if (error && error.code === "EADDRINUSE") {
      const fallbackPort = port + 1;
      console.warn(`[Server] Port ${port} is busy. Trying ${fallbackPort} instead.`);
      httpServer.removeListener("error", onError);
      wss.removeListener("error", onError);
      startServer(fallbackPort);
      return;
    }

    console.error("[Server] Failed to start server:", error);
    process.exit(1);
  };

  httpServer.removeListener("error", onError);
  wss.removeListener("error", onError);
  httpServer.on("error", onError);
  wss.on("error", onError);

  httpServer.listen(port, () => {
    httpServer.removeListener("error", onError);
    wss.removeListener("error", onError);
    console.log(`[Server] HTTP & WebSocket running on http://localhost:${port}`);
    console.log(`[Server] Debug logging enabled.`);
  });
}

startServer(PORT);

const server = new Server({
  name: "threejs-plm-mcp",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS
}));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const {
    name,
    arguments: args
  } = request.params;
  if (!isBrowserConnected()) return {
    isError: true,
    content: [{
      type: "text",
      text: "Error: No active browser connection."
    }]
  };
  sendActionsToBrowser([{
    name,
    args
  }]);
  return {
    content: [{
      type: "text",
      text: `Executed ${name}`
    }]
  };
});
await server.connect(new StdioServerTransport());
process.on("SIGINT", () => {
  wss.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  wss.close();
  process.exit(0);
});