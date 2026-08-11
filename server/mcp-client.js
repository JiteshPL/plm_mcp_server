import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client = null;
let transport = null;

// Prevent multiple simultaneous connections
let connectingPromise = null;


// ============================================================
// CONNECT MCP CLIENT
// ============================================================

export async function connectMcpClient() {

    // Already connected
    if (client) {
        return client;
    }

    // Connection already in progress
    if (connectingPromise) {
        return connectingPromise;
    }


    connectingPromise = (async () => {

        console.log(
            "[MCP Client] Connecting to PLM MCP Server..."
        );


        const serverPath =
            new URL(
                "./mcp-server.js",
                import.meta.url
            ).pathname;


        // Windows path fix
        const normalizedServerPath =
            decodeURIComponent(
                serverPath
            ).replace(
                /^\/([A-Z]:)/,
                "$1"
            );


        console.log(
            "[MCP Client] MCP server:",
            normalizedServerPath
        );


        const newClient =
            new Client(
                {
                    name:
                        "plm-langgraph-agent",

                    version:
                        "1.0.0"
                },
                {
                    capabilities: {}
                }
            );


        const newTransport =
            new StdioClientTransport({

                command:
                    process.execPath,

                args: [
                    normalizedServerPath
                ],

                stderr:
                    "inherit"
            });


        await newClient.connect(
            newTransport
        );


        console.log(
            "[MCP Client] Connected to PLM MCP Server"
        );


        client =
            newClient;

        transport =
            newTransport;


        return client;

    })();


    try {

        return await connectingPromise;

    } catch (error) {

        client = null;
        transport = null;

        console.error(
            "[MCP Client] Connection failed:",
            error
        );

        throw error;

    } finally {

        connectingPromise = null;
    }
}


// ============================================================
// DISCOVER TOOLS
// ============================================================

export async function listMcpTools() {

    const mcp =
        await connectMcpClient();


    console.log(
        "[MCP Client] Requesting MCP tools..."
    );


    const result =
        await mcp.listTools();


    const tools =
        result?.tools || [];


    console.log(
        "[MCP Client] Available tools:"
    );


    tools.forEach(tool => {

        console.log(
            `  - ${tool.name}`
        );

    });


    return tools;
}


// ============================================================
// EXECUTE TOOL
// ============================================================

export async function callMcpTool(
    name,
    args = {}
) {

    const mcp =
        await connectMcpClient();


    console.log(
        `[MCP Client] Calling tool: ${name}`,
        args
    );


    const result =
        await mcp.callTool({

            name,

            arguments:
                args
        });


    console.log(
        `[MCP Client] Tool result: ${name}`,
        result
    );


    return result;
}


// ============================================================
// CLOSE
// ============================================================

export async function closeMcpClient() {

    if (!client) {
        return;
    }


    try {

        await client.close();

    } catch (error) {

        console.warn(
            "[MCP Client] Close error:",
            error.message
        );

    } finally {

        client = null;
        transport = null;

        console.log(
            "[MCP Client] Disconnected"
        );
    }
}