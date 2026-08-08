import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { MAX_NEW_TOKENS, MODEL_NAME, TEMPERATURE } from "./config.js";
import { isBrowserConnected, sendActionsToBrowser } from "./browser-bridge.js";
import { getClarification, isResetRequest, parseLocalIntent } from "./intent.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const State = Annotation.Root({
  message: Annotation, history: Annotation({ default: () => [] }), clarification: Annotation({ default: () => null }),
  executedTools: Annotation({ default: () => [] }), reply: Annotation({ default: () => "" }), llmFailed: Annotation({ default: () => false })
});

export function createCommandGraph(openai) {
  const detectReset = state => isResetRequest(state.message) ? { executedTools: [{ name: "reset_scene", args: {} }], reply: "Scene and camera reset to the initial view." } : {};
  const clarify = state => ({ clarification: getClarification(state.message) });
  const planLlm = async state => {
    try {
      const tools = TOOL_DEFINITIONS.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
      const response = await openai.chat.completions.create({ model: MODEL_NAME, messages: [{ role: "system", content: "You are an AI CAD assistant. Use tool calls to control the 3D canvas. Never guess a highlight color, camera preset, section offset, or explosion factor: ask the user to choose when any is missing." }, ...state.history, { role: "user", content: state.message }], tools, tool_choice: "auto", temperature: TEMPERATURE, max_tokens: MAX_NEW_TOKENS });
      const message = response.choices[0].message;
      const executedTools = (message.tool_calls || []).map(call => ({ name: call.function.name, args: typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments }));
      return { executedTools, reply: message.content || (executedTools.length ? `Executed action: ${executedTools.map(tool => tool.name).join(", ")}` : "Command received, but no matching 3D action found."), llmFailed: false };
    } catch (error) {
      console.warn("[LangGraph: plan_llm] LLM planning failed; routing to fallback.", error.message);
      return { llmFailed: true };
    }
  };
  const fallback = state => { const executedTools = parseLocalIntent(state.message); return executedTools ? { executedTools, reply: `Executed action: ${executedTools.map(action => action.name).join(", ")}` } : { executedTools: [], reply: "Command received, but no matching 3D action found." }; };
  const dispatch = state => {
    if (!Array.isArray(state.executedTools) || !state.executedTools.length) return {};
    if (!isBrowserConnected()) return { reply: `${state.reply} (Warning: 3D Browser View is not connected over WebSocket)` };
    console.log(`[LangGraph: dispatch] Sending ${state.executedTools.length} action(s): ${state.executedTools.map(tool => tool.name).join(", ")}`);
    sendActionsToBrowser(state.executedTools);
    return {};
  };
  return new StateGraph(State)
    .addNode("detect_reset", detectReset).addNode("clarify", clarify).addNode("plan_llm", planLlm).addNode("fallback", fallback).addNode("dispatch", dispatch)
    .addEdge(START, "detect_reset")
    .addConditionalEdges("detect_reset", state => Array.isArray(state.executedTools) && state.executedTools.length ? "dispatch" : "clarify", ["dispatch", "clarify"])
    .addConditionalEdges("clarify", state => state.clarification ? END : "plan_llm", ["plan_llm", END])
    .addConditionalEdges("plan_llm", state => state.llmFailed ? "fallback" : "dispatch", ["fallback", "dispatch"])
    .addEdge("fallback", "dispatch").addEdge("dispatch", END).compile();
}
