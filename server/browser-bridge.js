import { WebSocketServer } from "ws";

let browserSocket = null;

export function attachBrowserBridge(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", ws => {
    browserSocket = ws;
    console.log("[MCP Server] Browser client connected on port 8080");
  });
  return wss;
}

export function isBrowserConnected() {
  return browserSocket?.readyState === 1;
}

export function sendActionsToBrowser(actions) {
  browserSocket.send(JSON.stringify({ actions }));
}
