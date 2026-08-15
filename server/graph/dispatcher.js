import { callMcpTool } from "../mcp-client.js";
import {
  agentStatus,
  extractMcpText,
  getToolExecutionMessage,
  normalizeActions,
} from "./helpers.js";

export const dispatch = async (state) => {
  const actions = normalizeActions(state.executedTools);
  if (!actions.length) {
    agentStatus({
      status: "error",
      message: "There are no 3D operations to execute.",
    });
    return {
      toolResults: [],
      reply: "No executable 3D operation was selected.",
    };
  }
  const results = [];
  agentStatus({
    status: "executing",
    message: `Executing ${actions.length} operation${actions.length === 1 ? "" : "s"}...`,
  });
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    const toolName = action.name;
    const args = action.args || {};
    const toolMessage = getToolExecutionMessage(toolName, args);
    agentStatus({
      status: "executing",
      tool: toolName,
      args,
      message: `${toolMessage} (${index + 1}/${actions.length})`,
    });

    console.log(`[LangGraph: dispatch] Calling MCP tool: ${toolName}`, args);

    try {
      const result = await callMcpTool(toolName, args);
      const text = extractMcpText(result);
      console.log(
        `[LangGraph: dispatch] MCP tool completed: ${toolName}`,
        text,
      );
      results.push({
        name: toolName,
        args,
        success: true,
        result,
        text,
      });
      agentStatus({
        status: "completed",
        tool: toolName,
        args,
        message: `${toolMessage} completed`,
      });
    } catch (error) {
      console.error(`[LangGraph] MCP tool failed: ${toolName}`, error);
      results.push({
        name: toolName,
        args,
        success: false,
        error: error?.message || String(error),
      });
      agentStatus({
        status: "error",
        tool: toolName,
        args,
        message: `${toolMessage} failed`,
      });
      continue;
    }
  }

  const failedCount = results.filter(
    (result) => result.success === false,
  ).length;

  if (failedCount === 0) {
    agentStatus({
      status: "completed",
      message: "All requested 3D operations completed.",
    });
  } else {
    agentStatus({
      status: "completed",
      message: `${results.length - failedCount} operation(s) completed; ${failedCount} failed.`,
    });
  }

  return {
    toolResults: results,
    executedTools: state.executedTools,
  };
};
