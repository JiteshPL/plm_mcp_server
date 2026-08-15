import { COLOR_OPTIONS } from "./tools.js";

export function isResetRequest(text) {
  const lower = text.toLowerCase();
  return /\breset\b/.test(lower) || /\b(default|initial)\s+(view|scene)\b/.test(lower) || /\b(return|restore)\b.*\b(default|initial)\b/.test(lower);
}

export function getExplosionFactor(text) {
  const lower = text.toLowerCase();
  if (!lower.includes("explode")) return null;
  const labelledFactor = lower.match(/\b(?:by|to)\s*(?:of\s*)?(\d+(?:\.\d+)?)\b|\bfactor\s*(?:as\s*|of\s*)?(\d+(?:\.\d+)?)\b/);
  const adjacentFactor = lower.match(/\bexplode(?:\s+(?:the\s+)?(?:view|assembly))?\s+(\d+(?:\.\d+)?)\b/);
  const value = labelledFactor?.[1] || labelledFactor?.[2] || adjacentFactor?.[1];
  if (value !== undefined) return parseFloat(value);

  if (/\b(slight|gentle|light|small|subtle|soft)\b/.test(lower)) return 2;
  if (/\b(moderate|medium|normal|clear|noticeable)\b/.test(lower)) return 5;
  if (/\b(heavy|strong|dramatic|dramatically|extreme|full|large|highly)\b/.test(lower)) return 20;
  return 1.2;
}

export function getSuggestedSection(text) {
  const lower = text.toLowerCase();
  let plane = "ZX";
  let offsetDistance = 0;

  if (/\bxy\b/.test(lower)) plane = "XY";
  else if (/\byz\b/.test(lower)) plane = "YZ";
  else if (/\bzx\b/.test(lower)) plane = "ZX";
  else if (/\bfront\b|\bback\b/.test(lower)) plane = "ZX";
  else if (/\bside\b|\bleft\b|\bright\b/.test(lower)) plane = "YZ";
  else if (/\btop\b|\bbottom\b/.test(lower)) plane = "XY";

  const match = lower.match(/\boffset\s*(?:of|to|at)?\s*(-?\d+(?:\.\d+)?)/i);
  if (match) offsetDistance = parseFloat(match[1]);

  return { plane, offsetDistance };
}

export function getClarification(text) {
  const lower = text.toLowerCase();
  const asksToHighlight = lower.includes("highlight") || lower.includes("vendor") || lower.includes("supplier");
  const hasSupplier = /\bvendor[\s-]?[abc]\b/i.test(text);
  const hasColor = /#[0-9a-f]{3,8}\b/i.test(text) || COLOR_OPTIONS.some(([color]) => lower.includes(color.toLowerCase()));
  if (asksToHighlight && !hasSupplier) return { reply: "Please choose a vendor to continue.", choices: ["Vendor-A", "Vendor-B", "Vendor-C"].map(vendor => ({ label: vendor, message: `${text} from ${vendor}` })) };
  if (asksToHighlight && !hasColor) return { reply: "Please choose a highlight color to continue.", choices: COLOR_OPTIONS.map(([label, hex]) => ({ label, message: `${text} with color ${hex}` })) };

  const views = ["isometric", "top", "bottom", "front", "right"];
  if (/\b(view|camera)\b/.test(lower) && !views.some(view => lower.includes(view))) return { reply: "Please choose a camera view to continue.", choices: views.map(view => ({ label: view[0].toUpperCase() + view.slice(1), message: `${text} with ${view} view` })) };
  return null;
}

export function applyActionSuggestions(actions, text) {
  if (!Array.isArray(actions)) return actions;

  return actions.map(action => {
    if (action?.name === "generate_exploded_view") {
      const explosionFactor = action.args?.explosionFactor;
      const resolvedFactor = typeof explosionFactor === "number" ? explosionFactor : getExplosionFactor(text);
      return {
        ...action,
        args: {
          ...(action.args || {}),
          explosionFactor: resolvedFactor ?? 1.2
        }
      };
    }

    if (action?.name === "create_cross_section") {
      const section = getSuggestedSection(text);
      return {
        ...action,
        args: {
          ...(action.args || {}),
          plane: action.args?.plane || section.plane,
          offsetDistance: action.args?.offsetDistance ?? section.offsetDistance,
          enabled: action.args?.enabled ?? true
        }
      };
    }

    return action;
  });
}

export function parseLocalIntent(text) {
  const lower = text.toLowerCase();
  if (isResetRequest(text)) return [{ name: "reset_scene", args: {} }];
  const actions = [];
  if (lower.includes("explode")) actions.push({ name: "generate_exploded_view", args: { explosionFactor: getExplosionFactor(text) ?? 1.2 } });
  if (["isometric", "top", "bottom", "front", "right"].some(view => lower.includes(view))) { let preset = "Isometric"; if (lower.includes("top")) preset = "Top"; if (lower.includes("bottom")) preset = "Bottom"; if (lower.includes("front")) preset = "Front"; if (lower.includes("right")) preset = "Right"; actions.push({ name: "set_camera_view", args: { preset } }); }
  if (lower.includes("vendor") || lower.includes("highlight")) { let supplier = "Vendor-A"; if (lower.includes("vendor-b") || lower.includes("vendor b")) supplier = "Vendor-B"; if (lower.includes("vendor-c") || lower.includes("vendor c")) supplier = "Vendor-C"; const colorHex = lower.match(/#[0-9a-f]{6}\b/i)?.[0] || COLOR_OPTIONS.find(([color]) => lower.includes(color.toLowerCase()))?.[1]; if (!colorHex) return null; actions.push({ name: "highlight_components", args: { filterCriteria: { supplier }, colorHex, isolateMode: false } }); }
  if (lower.includes("cross section") || lower.includes("section") || lower.includes("slice") || lower.includes("cut")) { const section = getSuggestedSection(text); actions.push({ name: "create_cross_section", args: { plane: section.plane, offsetDistance: section.offsetDistance, enabled: true } }); }
  return actions.length ? actions : null;
}
