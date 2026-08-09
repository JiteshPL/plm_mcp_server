import { WebSocketServer } from "ws";
import { DEBUG } from "./config.js";

let browserSocket = null;
let browserModelSummary = null;

function debugLog(message, ...args) {
  console.log(message, ...args);
}

export function attachBrowserBridge(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", ws => {
    browserSocket = ws;
    debugLog("[MCP Server] Browser client connected on port", httpServer.address()?.port || "unknown");
    ws.on("message", raw => {
      try {
        const message = JSON.parse(raw.toString());
        debugLog("[MCP Server] Browser message received", message);
        if (message?.type === "model-summary") {
          browserModelSummary = message.summary;
          debugLog("[MCP Server] Received browser model summary", message.summary);
        }
      } catch (error) {
        console.warn("[MCP Server] Ignored malformed browser message", error.message);
      }
    });
  });
  return wss;
}

export function isBrowserConnected() {
  return browserSocket?.readyState === 1;
}

export function sendActionsToBrowser(actions) {
  debugLog("[MCP Server] Sending actions to browser", JSON.stringify(actions, null, 2));
  browserSocket.send(JSON.stringify({ actions }));
}

export function getBrowserModelSummary() {
  return browserModelSummary;
}
