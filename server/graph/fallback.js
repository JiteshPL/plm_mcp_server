import { isResetRequest, parseLocalIntent, getClarification } from "../intent.js";
import { agentStatus, getAgentToolMessage, normalizeActions } from "./helpers.js";

export const detectReset = (state) => {
  const isReset = isResetRequest(state.message);
  console.log("[LangGraph] detect_reset", {
    message: state.message,
    isReset,
  });

  if (!isReset) {
    return {};
  }
  agentStatus({
    status: "tool_selected",
    tool: "reset_scene",
    message: "Reset request detected. Preparing to restore the assembly.",
  });
  return {
    executedTools: [
      {
        name: "reset_scene",
        args: {},
      },
    ],
    reply: "Resetting the scene and camera.",
  };
};

export const clarify = (state) => {
  const clarification = getClarification(state.message);
  console.log("[LangGraph] clarify", {
    message: state.message,
    clarification,
  });
  if (clarification) {
    agentStatus({
      status: "clarification",
      message: "Waiting for your selection.",
      choices: clarification.choices || [],
    });
  }
  return {
    clarification,
  };
};

export const fallback = (state) => {
  agentStatus({
    status: "fallback",
    message: "Creating a local fallback plan...",
  });
  try {
    const executedTools = normalizeActions(parseLocalIntent(state.message));
    if (!executedTools.length) {
      agentStatus({
        status: "error",
        message: "I couldn't determine the required 3D operation.",
      });
      return {
        executedTools: [],
        reply: "I couldn't determine the required 3D operation.",
        llmFailed: true,
      };
    }

    executedTools.forEach((tool) => {
      agentStatus({
        status: "tool_selected",
        tool: tool.name,
        args: tool.args || {},
        message: getAgentToolMessage(tool.name, tool.args || {}),
      });
    });

    return {
      executedTools,
      reply: "I’ll update the 3D model based on your request.",
      llmFailed: true,
    };
  } catch (error) {
    console.error("[LangGraph: fallback] Failed:", error);
    agentStatus({
      status: "error",
      message: "Fallback planning failed.",
    });
    return {
      executedTools: [],
      reply: "I couldn't determine the required 3D operation.",
      llmFailed: true,
    };
  }
};
