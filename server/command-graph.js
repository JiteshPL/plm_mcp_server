import {
  Annotation,
  END,
  START,
  StateGraph
} from "@langchain/langgraph";

import {
  DEBUG,
  MAX_NEW_TOKENS,
  MODEL_NAME,
  TEMPERATURE
} from "./config.js";

import {
  applyActionSuggestions,
  getClarification,
  isResetRequest,
  parseLocalIntent
} from "./intent.js";

import {
  TOOL_DEFINITIONS
} from "./tools.js";

import {
  getBrowserModelSummary,
  isBrowserConnected,
  sendAgentStatus
} from "./browser-bridge.js";

import {
    listMcpTools,
    callMcpTool
} from "./mcp-client.js";


// ============================================================
// STATE
// ============================================================

const State = Annotation.Root({

  message: Annotation,

  history: Annotation({
    default: () => []
  }),

  clarification: Annotation({
    default: () => null
  }),

  executedTools: Annotation({
    default: () => []
  }),

  reply: Annotation({
    default: () => ""
  }),

  llmFailed: Annotation({
    default: () => false
  }),

  toolResults: Annotation({
    default: () => []
  })
});


// ============================================================
// DEBUG
// ============================================================

function debugLog(message, ...args) {

  if (DEBUG) {
    console.log(message, ...args);
  }
}


// ============================================================
// SAFE AGENT STATUS
//
// IMPORTANT:
// Status failure must NEVER break LangGraph.
// ============================================================

function agentStatus({
  status,
  message,
  tool = null,
  args = null
}) {

  try {

    sendAgentStatus({
      status,
      message,
      tool,
      args
    });

  } catch (error) {

    console.warn(
      "[Agent Status] Failed:",
      error.message
    );
  }
}


// ============================================================
// USER-FRIENDLY TOOL MESSAGE
// ============================================================

function getAgentToolMessage(
  toolName,
  args = {}
) {

  switch (toolName) {

    case "find_related_parts":

      return `Finding parts related to ${
        args.partName || "the selected part"
      }`;


    case "isolate_part":

      return `Isolating ${
        args.partName || "the requested part"
      }`;


    case "highlight_components":

      return "Highlighting matching components";


    case "set_camera_view":

      return `Changing camera to ${
        args.preset ||
        args.view ||
        "requested"
      } view`;


    case "generate_exploded_view":

      return "Preparing exploded assembly view";


    case "explode_assembly":

      return "Exploding the assembly";


    case "create_cross_section":

      return `Creating ${
        args.plane
          ? `${args.plane} `
          : ""
      }cross section`;


    case "highlight_part":

      return `Highlighting ${
        args.partName || "the requested part"
      }`;


    case "reset_scene":

      return "Restoring the original assembly";


    default:

      return `Using ${toolName}`;
  }
}


// ============================================================
// TOOL EXECUTION MESSAGE
// ============================================================

function getToolExecutionMessage(
  toolName,
  args = {}
) {

  return getAgentToolMessage(
    toolName,
    args
  );
}


// ============================================================
// NORMALIZE TOOL ACTIONS
// ============================================================

function normalizeActions(actions) {

  if (!Array.isArray(actions)) {
    return [];
  }

  return actions
    .filter(Boolean)
    .map(action => ({

      name:
        action.name ||
        action.tool ||
        action.toolName,

      args:
        action.args ||
        action.arguments ||
        {}
    }))
    .filter(action => action.name);
}


// ============================================================
// DETECT RESET
// ============================================================

const detectReset = state => {

  const isReset =
    isResetRequest(
      state.message
    );

  debugLog(
    "[LangGraph] detect_reset",
    {
      message: state.message,
      isReset
    }
  );

  if (!isReset) {
    return {};
  }

  agentStatus({
    status: "tool_selected",
    tool: "reset_scene",
    message:
      "Reset request detected. Preparing to restore the assembly."
  });

  return {

    executedTools: [
      {
        name: "reset_scene",
        args: {}
      }
    ],

    reply:
      "Resetting the scene and camera."
  };
};


// ============================================================
// CLARIFICATION
// ============================================================

const clarify = state => {

  const clarification =
    getClarification(
      state.message
    );

  debugLog(
    "[LangGraph] clarify",
    {
      message: state.message,
      clarification
    }
  );

  if (clarification) {

    agentStatus({
      status: "clarification",
      message: clarification
    });
  }

  return {
    clarification
  };
};


// ============================================================
// LLM PLANNER
// ============================================================

// ============================================================
// LLM PLANNER
// ============================================================

const createPlanLlm = openai => {

  if (!openai) {
    throw new Error(
      "createPlanLlm received undefined openai"
    );
  }

  console.log(
    "[DEBUG] createPlanLlm received OpenAI:",
    {
      openaiExists: !!openai,
      openaiType: typeof openai,
      hasChat: !!openai?.chat,
      hasCompletions: !!openai?.chat?.completions
    }
  );

  return async state => {

    console.log(
      "[DEBUG] planLlm openai:",
      {
        exists: !!openai,
        type: typeof openai,
        hasChat: !!openai?.chat,
        hasCompletions: !!openai?.chat?.completions
      }
    );

    // REST OF YOUR EXISTING planLlm CODE
    console.log(
        "[DEBUG] planLlm openai:",
        {
            exists: !!openai,
            type: typeof openai,
            hasChat: !!openai?.chat,
            hasCompletions: !!openai?.chat?.completions
        }
    );

    agentStatus({
        status: "thinking",
        message:
            "Understanding your PLM request..."
    });

    try {

        // ====================================================
        // 1. DISCOVER MCP TOOLS
        // ====================================================

        agentStatus({
            status: "thinking",
            message:
                "Checking available PLM capabilities..."
        });


const mcpTools = await listMcpTools();

sendAgentStatus({
    status: "thinking",
    message: `Discovered ${mcpTools.length} PLM capabilities. Selecting the best operation...`
});

        console.log(
            "[LangGraph] MCP tools discovered:",
            mcpTools.map(
                tool => tool.name
            )
        );


        if (!mcpTools.length) {

            throw new Error(
                "MCP server returned no tools"
            );
        }


        // ====================================================
        // 2. CONVERT MCP TOOLS TO LLM TOOL FORMAT
        // ====================================================

        const tools =
            mcpTools.map(tool => ({

                type: "function",

                function: {

                    name:
                        tool.name,

                    description:
                        tool.description || "",

                    parameters:
                        tool.inputSchema || {
                            type: "object",
                            properties: {}
                        }
                }
            }));


        // ====================================================
        // 3. SEND DYNAMIC TOOLS TO LLM
        // ====================================================

        agentStatus({
            status: "thinking",
            message:
                `${tools.length} PLM capabilities available. Selecting the right operation...`
        });

      const modelSummary = getBrowserModelSummary();
      const modelSummaryText = modelSummary ? `Assembly summary:\n- partCount: ${modelSummary.partCount}\n- boundingBox: ${JSON.stringify(modelSummary.boundingBox)}\n- supplierBreakdown: ${JSON.stringify(modelSummary.supplierBreakdown)}\n- representativeParts: ${JSON.stringify(modelSummary.representativeParts.slice(0, 8))}` : "Assembly summary: not available yet";
      debugLog("[LangGraph] plan_llm start", {
        message: state.message,
        historyLength: state.history ? state.history.length : 0,
        modelSummaryText
      });
        const response =
            await openai.chat.completions.create({

                model:
                    MODEL_NAME,

                messages: [

                    {
                        role: "system",

                        content:
                            `You are an AI CAD assistant.

Use the available PLM tools to control
the Three.js CAD assembly.

Select the appropriate tools based on
the user's request.

Do not invent tools.
Only use the tools provided to you.`
                    },

                    {
                        role: "system",

                        content:
                            modelSummaryText
                    },

                    ...(state.history || []),

                    {
                        role: "user",

                        content:
                            state.message
                    }
                ],

                tools,

                tool_choice: "auto",

                temperature:
                    TEMPERATURE,

                max_tokens:
                    MAX_NEW_TOKENS
            });


        // ====================================================
        // 4. EXTRACT TOOL CALLS
        // ====================================================

        const message =
            response?.choices?.[0]?.message;


        const executedTools =
            (message?.tool_calls || [])
                .map(call => {

                    let args = {};

                    try {

                        args =
                            typeof call.function.arguments === "string"

                                ? JSON.parse(
                                    call.function.arguments
                                )

                                : (
                                    call.function.arguments || {}
                                );

                    } catch {

                        return null;
                    }


                    return {

                        name:
                            call.function.name,

                        args
                    };

                })
                .filter(Boolean);


        // ====================================================
        // 5. LLM FAILED TO SELECT TOOL
        // ====================================================

        if (!executedTools.length) {

            agentStatus({

                status: "fallback",

                message:
                    "I couldn't identify a specific PLM operation. Trying fallback..."
            });


            return {

                executedTools: [],

                llmFailed: true,

                reply:
                    message?.content ||
                    "Trying fallback planning."
            };
        }


        // ====================================================
        // 6. TOOL SELECTED
        // ====================================================

        executedTools.forEach(tool => {

            agentStatus({

                status:
                    "tool_selected",

                tool:
                    tool.name,

                args:
                    tool.args,

                message:
                    getAgentToolMessage(
                        tool.name,
                        tool.args
                    )
            });

        });


        return {

            executedTools,

            llmFailed:
                false,

            reply:
                message?.content ||
                "Done — your requested PLM operation has been completed successfully."
        };


    } catch (error) {

        console.error(
            "[LangGraph: plan_llm] failed:",
            error
        );


        agentStatus({

            status:
                "fallback",

            message:
                "MCP tool discovery or LLM planning failed. Switching to fallback."
        });


        return {

            executedTools: [],

            llmFailed:
                true,

            reply:
                "Using fallback planning."
        };
    }
  };
};

// ============================================================
// FALLBACK
// ============================================================

const fallback = state => {

  agentStatus({

    status:
      "fallback",

    message:
      "Creating a local fallback plan..."
  });


  try {

    const executedTools =
      normalizeActions(
        parseLocalIntent(
          state.message
        )
      );


    if (!executedTools.length) {

      agentStatus({

        status:
          "error",

        message:
          "I couldn't determine the required 3D operation."
      });


      return {

        executedTools: [],

        reply:
          "I couldn't determine the required 3D operation.",

        llmFailed:
          true
      };
    }


    executedTools.forEach(tool => {

      agentStatus({

        status:
          "tool_selected",

        tool:
          tool.name,

        args:
          tool.args || {},

        message:
          getAgentToolMessage(
            tool.name,
            tool.args || {}
          )
      });
    });


    return {

      executedTools,

      reply:
        "I’ll update the 3D model based on your request.",

      llmFailed:
        true
    };


  } catch (error) {

    console.error(
      "[LangGraph: fallback] Failed:",
      error
    );


    agentStatus({

      status:
        "error",

      message:
        "Fallback planning failed."
    });


    return {

      executedTools: [],

      reply:
        "I couldn't determine the required 3D operation.",

      llmFailed:
        true
    };
  }
};


// ============================================================
// MCP RESULT TEXT
// ============================================================

function extractMcpText(result) {

  if (!result) {
    return "";
  }


  if (
    Array.isArray(
      result.content
    )
  ) {

    const textItem =
      result.content.find(
        item =>
          item &&
          item.type === "text"
      );


    if (
      textItem &&
      typeof textItem.text === "string"
    ) {

      return textItem.text;
    }
  }


  if (
    typeof result.text === "string"
  ) {

    return result.text;
  }


  if (
    typeof result === "string"
  ) {

    return result;
  }


  try {

    return JSON.stringify(
      result
    );

  } catch {

    return "";
  }
}


// ============================================================
// DISPATCH
//
// LangGraph
//    ↓
// MCP Client
//    ↓
// PLM MCP Server
//    ↓
// Browser Bridge
//    ↓
// WebSocket
//    ↓
// Three.js
// ============================================================

const dispatch = async state => {

  const actions =
    normalizeActions(
      state.executedTools
    );


  if (!actions.length) {

    agentStatus({

      status:
        "error",

      message:
        "There are no 3D operations to execute."
    });


    return {

      toolResults: [],

      reply:
        "No executable 3D operation was selected."
    };
  }


  const results = [];


  agentStatus({

    status:
      "executing",

    message:
      `Executing ${actions.length} operation${
        actions.length === 1
          ? ""
          : "s"
      }...`
  });


  for (
    let index = 0;
    index < actions.length;
    index++
  ) {

    const action =
      actions[index];


    const toolName =
      action.name;


    const args =
      action.args || {};


    const toolMessage =
      getToolExecutionMessage(
        toolName,
        args
      );


    // --------------------------------------------------------
    // ACTUAL EXECUTION STATUS
    // --------------------------------------------------------

    agentStatus({

      status:
        "executing",

      tool:
        toolName,

      args,

      message:
        `${toolMessage} (${index + 1}/${actions.length})`
    });


    console.log(
      `[LangGraph: dispatch] Calling MCP tool: ${toolName}`,
      args
    );


    try {

      // ------------------------------------------------------
      // MCP CLIENT
      // ------------------------------------------------------

      const result =
        await callMcpTool(
          toolName,
          args
        );


      const text =
        extractMcpText(
          result
        );


      console.log(
        `[LangGraph: dispatch] MCP tool completed: ${toolName}`,
        text
      );


      results.push({

        name:
          toolName,

        args,

        success:
          true,

        result,

        text
      });


      agentStatus({

        status:
          "completed",

        tool:
          toolName,

        args,

        message:
          `${toolMessage} completed`
      });


    } catch (error) {

      console.error(
        `[LangGraph] MCP tool failed: ${toolName}`,
        error
      );


      results.push({

        name:
          toolName,

        args,

        success:
          false,

        error:
          error?.message ||
          String(error)
      });


      agentStatus({

        status:
          "error",

        tool:
          toolName,

        args,

        message:
          `${toolMessage} failed`
      });


      // Continue with next tool.
      continue;
    }
  }


  const failedCount =
    results.filter(
      result =>
        result.success === false
    ).length;


  if (failedCount === 0) {

    agentStatus({

      status:
        "completed",

      message:
        "All requested 3D operations completed."
    });

  } else {

    agentStatus({

      status:
        "completed",

      message:
        `${results.length - failedCount} operation(s) completed; ${failedCount} failed.`
    });
  }


  return {

    toolResults:
      results,

    executedTools:
      state.executedTools
  };
};


// ============================================================
// CREATE GRAPH
// ============================================================

export function createCommandGraph(
  openai
) {

  console.log(
    "[DEBUG] createCommandGraph called",
    {
      openaiExists: !!openai,
      openaiType: typeof openai
    }
  );

  if (!openai) {
    throw new Error(
      "createCommandGraph received undefined openai"
    );
  }


  // IMPORTANT:
  // planLlm is created here, so it closes over
  // the SAME openai passed to createCommandGraph.

  const planLlm =
    createPlanLlm(openai);


  return new StateGraph(State)

    .addNode(
      "detect_reset",
      detectReset
    )

    .addNode(
      "clarify",
      clarify
    )

    .addNode(
      "plan_llm",
      planLlm
    )

    .addNode(
      "fallback",
      fallback
    )

    .addNode(
      "dispatch",
      dispatch
    )

    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    .addEdge(
      START,
      "detect_reset"
    )


    // --------------------------------------------------------
    // RESET
    //
    // reset -> dispatch
    // normal -> clarify
    // --------------------------------------------------------

    .addConditionalEdges(

      "detect_reset",

      state => {

        return (
          Array.isArray(
            state.executedTools
          ) &&
          state.executedTools.length

            ? "dispatch"

            : "clarify"
        );
      },

      [
        "dispatch",
        "clarify"
      ]
    )


    // --------------------------------------------------------
    // CLARIFICATION
    // --------------------------------------------------------

    .addConditionalEdges(

      "clarify",

      state => {

        return state.clarification

          ? END

          : "plan_llm";
      },

      [
        "plan_llm",
        END
      ]
    )


    // --------------------------------------------------------
    // LLM
    //
    // success -> dispatch
    // failure -> fallback
    // --------------------------------------------------------

    .addConditionalEdges(

      "plan_llm",

      state => {

        if (
          state.llmFailed ||
          !Array.isArray(
            state.executedTools
          ) ||
          state.executedTools.length === 0
        ) {

          return "fallback";
        }

        return "dispatch";
      },

      [
        "fallback",
        "dispatch"
      ]
    )


    // --------------------------------------------------------
    // fallback -> dispatch
    // --------------------------------------------------------

    .addEdge(
      "fallback",
      "dispatch"
    )


    // --------------------------------------------------------
    // dispatch -> END
    // --------------------------------------------------------

    .addEdge(
      "dispatch",
      END
    )


    // --------------------------------------------------------
    // COMPILE
    // --------------------------------------------------------

    .compile();
}