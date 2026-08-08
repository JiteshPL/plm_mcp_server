# PLM MCP Server

```
server/                 MCP, HTTP/WebSocket, LangGraph, and command logic
  index.js              Server entry point
  command-graph.js      LangGraph command workflow
  intent.js             Clarification and fallback intent parsing
  tools.js              MCP tool definitions
  browser-bridge.js     Browser WebSocket bridge
  config.js             Runtime configuration
ui/                     Standalone Three.js browser interface
  index.html            UI entry point
  app.js                Three.js scene and browser tool handlers
  chat-ui.js            Chat and clarification controls
  styles.css            UI styles
server.js               Backward-compatible launcher
```

Run the server with `npm start`, then open `ui/index.html` in a browser.
