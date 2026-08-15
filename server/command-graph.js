import { END, START, StateGraph } from "@langchain/langgraph";

import { State } from "./graph/state.js";
import { createPlanLlm } from "./graph/planner.js";
import { clarify, detectReset, fallback } from "./graph/fallback.js";
import { dispatch } from "./graph/dispatcher.js";

export function createCommandGraph(openai) {
  console.log("[DEBUG] createCommandGraph called", {
    openaiExists: !!openai,
    openaiType: typeof openai,
  });

  if (!openai) {
    throw new Error("createCommandGraph received undefined openai");
  }

  const planLlm = createPlanLlm(openai);

  return (
    new StateGraph(State)
      .addNode("detect_reset", detectReset)
      .addNode("clarify", clarify)
      .addNode("plan_llm", planLlm)
      .addNode("fallback", fallback)
      .addNode("dispatch", dispatch)

      .addEdge(START, "detect_reset")

      .addConditionalEdges(
        "detect_reset",
        (state) => {
          return Array.isArray(state.executedTools) && state.executedTools.length
            ? "dispatch"
            : "clarify";
        },
        ["dispatch", "clarify"],
      )

      .addConditionalEdges(
        "clarify",
        (state) => {
          return state.clarification ? END : "plan_llm";
        },
        ["plan_llm", END],
      )

      .addConditionalEdges(
        "plan_llm",
        (state) => {
          if (
            state.llmFailed ||
            !Array.isArray(state.executedTools) ||
            state.executedTools.length === 0
          ) {
            return "fallback";
          }

          return "dispatch";
        },
        ["fallback", "dispatch"],
      )

      .addEdge("fallback", "dispatch")
      .addEdge("dispatch", END)
      .compile()
  );
}
