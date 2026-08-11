import WebSocket from "ws";

const HOST =
    process.env.MCP_HOST_URL ||
    "ws://localhost:8080";

let socket = null;

let requestCounter = 0;

const pendingRequests = new Map();


export async function connectToHostBridge() {

    if (
        socket &&
        socket.readyState === WebSocket.OPEN
    ) {
        return;
    }


    socket = new WebSocket(
        HOST
    );


    socket.on(
        "open",
        () => {

            console.error(
                "[MCP Server] Connected to host WebSocket"
            );

            socket.send(
                JSON.stringify({
                    type: "client-role",
                    role: "mcp-server"
                })
            );

        }
    );


    socket.on(
        "message",
        raw => {

            try {

                const message =
                    JSON.parse(
                        raw.toString()
                    );


                if (
                    message.type ===
                    "action-result"
                ) {

                    const pending =
                        pendingRequests.get(
                            message.requestId
                        );


                    if (pending) {

                        pendingRequests.delete(
                            message.requestId
                        );

                        pending.resolve(
                            message.result
                        );

                    }

                }

            } catch (error) {

                console.error(
                    "[MCP Server] Invalid bridge message",
                    error
                );

            }

        }
    );


    socket.on(
        "close",
        () => {

            console.error(
                "[MCP Server] Host bridge disconnected"
            );

            socket = null;

        }
    );


    socket.on(
        "error",
        error => {

            console.error(
                "[MCP Server] Bridge error",
                error.message
            );

        }
    );


    await new Promise(
        (resolve, reject) => {

            const timeout =
                setTimeout(
                    () => {

                        reject(
                            new Error(
                                "Timed out connecting to host WebSocket"
                            )
                        );

                    },
                    5000
                );


            socket.once(
                "open",
                () => {

                    clearTimeout(
                        timeout
                    );

                    resolve();

                }
            );

            socket.once(
                "error",
                error => {

                    clearTimeout(
                        timeout
                    );

                    reject(error);

                }
            );

        }
    );
}


export async function executeBrowserAction(
    name,
    args
) {

    await connectToHostBridge();


    const requestId =
        `mcp-${++requestCounter}`;


    return new Promise(
        (resolve, reject) => {

            pendingRequests.set(
                requestId,
                {
                    resolve,
                    reject
                }
            );


            socket.send(
                JSON.stringify({

                    type:
                        "mcp-action",

                    requestId,

                    action: {
                        name,
                        args
                    }

                })
            );


            setTimeout(
                () => {

                    if (
                        pendingRequests.has(
                            requestId
                        )
                    ) {

                        pendingRequests.delete(
                            requestId
                        );

                        reject(
                            new Error(
                                `Browser action timed out: ${name}`
                            )
                        );

                    }

                },
                30000
            );

        }
    );
}