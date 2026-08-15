import { WebSocketServer } from "ws";
let browserSocket = null;
let mcpServerSocket = null;
let browserModelSummary = null;
function debugLog(message, ...args) {
  console.log(message, ...args);
}
export function attachBrowserBridge(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
  });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "client-role") {
          if (message.role === "browser") {
            browserSocket = ws;
            console.log("[Bridge] Browser connected");
          }

          if (message.role === "mcp-server") {
            mcpServerSocket = ws;
            console.log("[Bridge] MCP server connected");
          }
          return;
        }

        if (message.type === "model-summary") {
          browserModelSummary = message.summary;
          return;
        }

        if (message.type === "mcp-action") {
          if (browserSocket?.readyState === 1) {
            browserSocket.send(
              JSON.stringify({
                type: "execute-action",
                requestId: message.requestId,
                action: message.action,
              }),
            );
          }
          return;
        }

        if (message.type === "action-result") {
          if (mcpServerSocket?.readyState === 1) {
            mcpServerSocket.send(JSON.stringify(message));
          }
        }
      } catch (error) {
        console.warn("[Bridge] Invalid message", error.message);
      }
    });

    ws.on("close", () => {
      if (ws === browserSocket) {
        browserSocket = null;
      }

      if (ws === mcpServerSocket) {
        mcpServerSocket = null;
      }
    });
  });

  return wss;
}

export function sendAgentStatus(status) {
  if (!browserSocket || browserSocket.readyState !== 1) {
    console.log("[Agent Status] Browser not connected");
    return;
  }
  browserSocket.send(
    JSON.stringify({
      type: "agent_status",
      ...status,
    }),
  );
  console.log("[Agent Status]", status);
}

export function isBrowserConnected() {
  return browserSocket?.readyState === 1;
}

export function sendActionsToBrowser(actions) {
  if (!browserSocket || browserSocket.readyState !== 1) {
    throw new Error("Browser is not connected");
  }
  browserSocket.send(
    JSON.stringify({
      actions,
    }),
  );
}

export function getBrowserModelSummary() {
  return browserModelSummary;
}
