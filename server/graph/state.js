import { Annotation } from "@langchain/langgraph";

export const State = Annotation.Root({
  message: Annotation,

  history: Annotation({
    default: () => [],
  }),

  clarification: Annotation({
    default: () => null,
  }),

  executedTools: Annotation({
    default: () => [],
  }),

  reply: Annotation({
    default: () => "",
  }),

  llmFailed: Annotation({
    default: () => false,
  }),

  toolResults: Annotation({
    default: () => [],
  }),
});
