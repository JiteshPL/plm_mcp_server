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
  sendActionsToBrowser,
  sendAgentStatus
} from "./browser-bridge.js";

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
  })
});

function debugLog(message, ...args) {
  console.log(message, ...args);
}

function getAgentToolMessage(toolName, args = {}) {

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
                args.preset || "requested"
            } view`;

    case "generate_exploded_view":
      return "Preparing exploded assembly view";

    case "create_cross_section":
      return "Creating cross section";

    case "reset_scene":
      return "Restoring the original assembly";

    default:
      return `Using ${toolName}`;
  }
}

export function createCommandGraph(openai) {
  const detectReset = state => {
    const isReset = isResetRequest(state.message);
    debugLog("[LangGraph] detect_reset", {
      message: state.message,
      isReset
    });
    return isReset ? {
      executedTools: [{
        name: "reset_scene",
        args: {}
      }],
      reply: "Scene and camera reset to the initial view."
    } : {};
  };
  const clarify = state => {
    const clarification = getClarification(state.message);
    debugLog("[LangGraph] clarify", {
      message: state.message,
      clarification
    });
    return {
      clarification
    };
  };
  const planLlm = async state => {
    try {
      const tools = TOOL_DEFINITIONS.map(tool => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }));
      const modelSummary = getBrowserModelSummary();
      const modelSummaryText = modelSummary ? `Assembly summary:\n- partCount: ${modelSummary.partCount}\n- boundingBox: ${JSON.stringify(modelSummary.boundingBox)}\n- supplierBreakdown: ${JSON.stringify(modelSummary.supplierBreakdown)}\n- representativeParts: ${JSON.stringify(modelSummary.representativeParts.slice(0, 8))}` : "Assembly summary: not available yet";
      debugLog("[LangGraph] plan_llm start", {
        message: state.message,
        historyLength: state.history ? state.history.length : 0,
        modelSummaryText
      });
      sendAgentStatus({
        status: "thinking",
        message: "Understanding your request..."
      });
      const response = await openai.chat.completions.create({
        model: MODEL_NAME,
        messages: [{
          role: "system",
          content: "You are an AI CAD assistant. Use tool calls to control the 3D canvas. Never ask the user for an explosion factor unless they explicitly request a numeric value. Infer the intensity from words like 'dramatically', 'moderately', 'slightly', 'strongly', 'extremely'. Use a high default such as 20 for dramatic requests, 5 for moderate requests, and 2 for subtle requests. For section requests, use ZX plane for front/back, YZ for left/right, and XY for top/bottom unless the user specifies otherwise."
        }, {
          role: "system",
          content: modelSummaryText
        }, ...state.history, {
          role: "user",
          content: state.message
        }],
        tools,
        tool_choice: "auto",
        temperature: TEMPERATURE,
        max_tokens: MAX_NEW_TOKENS
      });
      const message = response.choices[0].message;
      debugLog("[LangGraph] llm_response raw content", message.content);
      debugLog("[LangGraph] llm_response tool_calls", JSON.stringify(message.tool_calls || [], null, 2));
      const executedTools =
        (message.tool_calls || []).map(call => {

          const args =
            typeof call.function.arguments === "string" ?
            JSON.parse(call.function.arguments) :
            call.function.arguments;

          const toolName =
            call.function.name;

          sendAgentStatus({
            status: "tool_selected",
            tool: toolName,
            message: getAgentToolMessage(
              toolName,
              args
            )
          });

          return {
            name: toolName,
            args
          };
        });
      const resolvedTools = applyActionSuggestions(executedTools, state.message);
      resolvedTools.forEach(tool => {

        sendAgentStatus({
          status: "executing",
          tool: tool.name,
          args: tool.args,
          message: getAgentToolMessage(
            tool.name,
            tool.args
          )
        });

      });
      debugLog("[LangGraph] resolved tools", JSON.stringify(resolvedTools, null, 2));
      return {
        executedTools: resolvedTools,

        reply: message.content ||
          (
            resolvedTools.length ?
            "I’ll update the 3D model based on your request." :
            "I couldn't find a matching 3D action."
          ),

        llmFailed: false
      };
    } catch (error) {
      sendAgentStatus({
        status: "error",
        message: "LLM planning failed. Trying local command parsing..."
      });
      console.warn("[LangGraph: plan_llm] LLM planning failed; routing to fallback.", error.message);
      return {
        llmFailed: true
      };
    }
  };
const fallback = state => {

    const executedTools =
        parseLocalIntent(state.message);

    if (!executedTools) {

        sendAgentStatus({
            status: "error",
            message: "I couldn't determine the required 3D operation."
        });

        return {
            executedTools: [],
            reply:
                "I couldn't determine the required 3D operation."
        };
    }

    executedTools.forEach(tool => {

        sendAgentStatus({
            status: "tool_selected",
            tool: tool.name,
            message: getAgentToolMessage(
                tool.name,
                tool.args || {}
            )
        });

    });

    return {
        executedTools,

        reply:
            "I’ll update the 3D model based on your request."
    };
};
const dispatch = state => {

    if (
        !Array.isArray(state.executedTools) ||
        !state.executedTools.length
    ) {
        return {};
    }

    if (!isBrowserConnected()) {

        sendAgentStatus({
            status: "error",
            message:
                "3D browser is not connected."
        });

        return {
            reply:
                "The 3D browser is not connected."
        };
    }

    debugLog(
        "[LangGraph] dispatch start",
        {
            toolCount:
                state.executedTools.length,
            tools:
                state.executedTools
        }
    );

    sendAgentStatus({
        status: "executing",
        message: "Updating the 3D model..."
    });

    sendActionsToBrowser(
        state.executedTools
    );

    sendAgentStatus({
        status: "completed",
        message: "3D model updated."
    });

    debugLog(
        "[LangGraph] dispatch complete",
        {
            toolCount:
                state.executedTools.length
        }
    );

    return {
        reply:
            "Done — I updated the 3D model."
    };
};
  return new StateGraph(State)
    .addNode("detect_reset", detectReset).addNode("clarify", clarify).addNode("plan_llm", planLlm).addNode("fallback", fallback).addNode("dispatch", dispatch)
    .addEdge(START, "detect_reset")
    .addConditionalEdges("detect_reset", state => Array.isArray(state.executedTools) && state.executedTools.length ? "dispatch" : "clarify", ["dispatch", "clarify"])
    .addConditionalEdges("clarify", state => state.clarification ? END : "plan_llm", ["plan_llm", END])
    .addConditionalEdges("plan_llm", state => state.llmFailed || !Array.isArray(state.executedTools) || state.executedTools.length === 0 ? "fallback" : "dispatch", ["fallback", "dispatch"])
    .addEdge("fallback", "dispatch").addEdge("dispatch", END).compile();
}