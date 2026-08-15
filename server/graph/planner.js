import { MAX_NEW_TOKENS, MODEL_NAME, TEMPERATURE } from "../config.js";
import { getBrowserModelSummary } from "../browser-bridge.js";
import { listMcpTools } from "../mcp-client.js";
import { agentStatus, debugLog } from "./helpers.js";

export const createPlanLlm = (openai) => {
  if (!openai) {
    throw new Error("createPlanLlm received undefined openai");
  }

  console.log("[DEBUG] createPlanLlm received OpenAI:", {
    openaiExists: !!openai,
    openaiType: typeof openai,
    hasChat: !!openai?.chat,
    hasCompletions: !!openai?.chat?.completions,
  });

  return async (state) => {
    console.log("[DEBUG] planLlm openai:", {
      exists: !!openai,
      type: typeof openai,
      hasChat: !!openai?.chat,
      hasCompletions: !!openai?.chat?.completions,
    });

    agentStatus({
      status: "thinking",
      message: "Understanding your PLM request...",
    });

    try {
      agentStatus({
        status: "thinking",
        message: "Checking available PLM capabilities...",
      });

      const mcpTools = await listMcpTools();

      agentStatus({
        status: "thinking",
        message: `Discovered ${mcpTools.length} PLM capabilities. Selecting the best operation...`,
      });

      console.log(
        "[LangGraph] MCP tools discovered:",
        mcpTools.map((tool) => tool.name),
      );

      if (!mcpTools.length) {
        throw new Error("MCP server returned no tools");
      }

      const tools = mcpTools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.inputSchema || {
            type: "object",
            properties: {},
          },
        },
      }));

      agentStatus({
        status: "thinking",
        message: `${tools.length} PLM capabilities available. Selecting the right operation...`,
      });

      const modelSummary = getBrowserModelSummary();
      const modelSummaryText = modelSummary
        ? `Assembly summary:\n- partCount: ${modelSummary.partCount}\n- boundingBox: ${JSON.stringify(modelSummary.boundingBox)}\n- supplierBreakdown: ${JSON.stringify(modelSummary.supplierBreakdown)}\n- representativeParts: ${JSON.stringify(modelSummary.representativeParts.slice(0, 8))}`
        : "Assembly summary: not available yet";

      debugLog("[LangGraph] plan_llm start", {
        message: state.message,
        historyLength: state.history ? state.history.length : 0,
        modelSummaryText,
      });

      const response = await openai.chat.completions.create({
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: `You are an AI CAD assistant.

Use the available PLM tools to control
the Three.js CAD assembly.

Select the appropriate tools based on
the user's request.

Do not invent tools.
Only use the tools provided to you.`,
          },
          {
            role: "system",
            content: modelSummaryText,
          },
          ...(state.history || []),
          {
            role: "user",
            content: state.message,
          },
        ],
        tools,
        tool_choice: "auto",
        temperature: TEMPERATURE,
        max_tokens: MAX_NEW_TOKENS,
      });

      const message = response?.choices?.[0]?.message;
      const executedTools = (message?.tool_calls || [])
        .map((call) => {
          let args = {};
          try {
            args =
              typeof call.function.arguments === "string"
                ? JSON.parse(call.function.arguments)
                : call.function.arguments || {};
          } catch {
            return null;
          }
          return {
            name: call.function.name,
            args,
          };
        })
        .filter(Boolean);

      if (!executedTools.length) {
        agentStatus({
          status: "fallback",
          message: "I couldn't identify a specific PLM operation. Trying fallback...",
        });

        return {
          executedTools: [],
          llmFailed: true,
          reply: message?.content || "Trying fallback planning.",
        };
      }

      executedTools.forEach((tool) => {
        agentStatus({
          status: "tool_selected",
          tool: tool.name,
          args: tool.args,
          message: `Using ${tool.name}`,
        });
      });

      const rawReply =
        typeof message?.content === "string" ? message.content.trim() : "";
      const cleanReply =
        rawReply && !/^\.?\/?tool_call\s*[>:-]?/i.test(rawReply)
          ? rawReply
          : "I applied the selected PLM operation.";

      return {
        executedTools,
        llmFailed: false,
        reply: cleanReply,
      };
    } catch (error) {
      console.error("[LangGraph: plan_llm] failed:", error);
      agentStatus({
        status: "fallback",
        message: "MCP tool discovery or LLM planning failed. Switching to fallback.",
      });

      return {
        executedTools: [],
        llmFailed: true,
        reply: "Using fallback planning.",
      };
    }
  };
};
