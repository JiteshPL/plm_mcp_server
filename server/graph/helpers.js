import { DEBUG } from "../config.js";
import { sendAgentStatus } from "../browser-bridge.js";

export function debugLog(message, ...args) {
  if (DEBUG) {
    console.log(message, ...args);
  }
}

export function agentStatus({ status, message, tool = null, args = null }) {
  try {
    sendAgentStatus({
      status,
      message,
      tool,
      args,
    });
  } catch (error) {
    console.warn("[Agent Status] Failed:", error.message);
  }
}

export function getAgentToolMessage(toolName, args = {}) {
  switch (toolName) {
    case "find_related_parts":
      return `Finding parts related to ${args.partName || "the selected part"}`;

    case "isolate_part":
      return `Isolating ${args.partName || "the requested part"}`;

    case "highlight_components":
      return "Highlighting matching components";

    case "set_camera_view":
      return `Changing camera to ${args.preset || args.view || "requested"} view`;

    case "generate_exploded_view":
      return "Preparing exploded assembly view";

    case "explode_assembly":
      return "Exploding the assembly";

    case "create_cross_section":
      return `Creating ${args.plane ? `${args.plane} ` : ""}cross section`;

    case "highlight_part":
      return `Highlighting ${args.partName || "the requested part"}`;

    case "reset_scene":
      return "Restoring the original assembly";

    default:
      return `Using ${toolName}`;
  }
}

export function getToolExecutionMessage(toolName, args = {}) {
  return getAgentToolMessage(toolName, args);
}

export function normalizeActions(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions
    .filter(Boolean)
    .map((action) => ({
      name: action.name || action.tool || action.toolName,
      args: action.args || action.arguments || {},
    }))
    .filter((action) => action.name);
}

export function extractMcpText(result) {
  if (!result) {
    return "";
  }

  if (Array.isArray(result.content)) {
    const textItem = result.content.find(
      (item) => item && item.type === "text",
    );

    if (textItem && typeof textItem.text === "string") {
      return textItem.text;
    }
  }

  if (typeof result.text === "string") {
    return result.text;
  }

  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}
