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
    TOOL_DEFINITIONS
} from "./tools.js";

import {
    connectToHostBridge,
    executeBrowserAction
} from "./mcp-browser-bridge.js";


const server = new Server(
    {
        name: "threejs-plm-mcp",
        version: "1.0.0"
    },
    {
        capabilities: {
            tools: {}
        }
    }
);


server.setRequestHandler(
    ListToolsRequestSchema,

    async () => {

        return {
            tools: TOOL_DEFINITIONS
        };

    }
);


server.setRequestHandler(
    CallToolRequestSchema,

    async request => {

        const {
            name,
            arguments: args = {}
        } = request.params;


        console.error(
            `[PLM MCP Server] Tool called: ${name}`,
            args
        );


        try {

            const result =
                await executeBrowserAction(
                    name,
                    args
                );


            console.error(
                `[PLM MCP Server] Tool result: ${name}`,
                result
            );


            return mcpTextResult(
                result
            );


        } catch (error) {

            console.error(
                `[PLM MCP Server] Tool failed: ${name}`,
                error
            );


            return {

                isError: true,

                content: [
                    {
                        type: "text",

                        text:
                            error?.message ||
                            "Tool execution failed"
                    }
                ]

            };
        }
    }
);

await connectToHostBridge();


const transport =
    new StdioServerTransport();


await server.connect(
    transport
);


console.error(
    "[PLM MCP Server] Running on stdio"
);

function mcpTextResult(value) {

    let text;

    if (typeof value === "string") {
        text = value;
    } else {
        try {
            text = JSON.stringify(
                value ?? {
                    success: true
                }
            );
        } catch {
            text = "Tool executed successfully";
        }
    }

    return {
        content: [
            {
                type: "text",
                text
            }
        ]
    };
}