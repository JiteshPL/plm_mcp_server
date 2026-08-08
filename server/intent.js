import { COLOR_OPTIONS } from "./tools.js";

export function isResetRequest(text) {
  const lower = text.toLowerCase();
  return /\breset\b/.test(lower) || /\b(default|initial)\s+(view|scene)\b/.test(lower) || /\b(return|restore)\b.*\b(default|initial)\b/.test(lower);
}

export function getClarification(text) {
  const lower = text.toLowerCase();
  const asksToHighlight = lower.includes("highlight") || lower.includes("vendor") || lower.includes("supplier");
  const hasSupplier = /\bvendor[\s-]?[abc]\b/i.test(text);
  const hasColor = /#[0-9a-f]{3,8}\b/i.test(text) || COLOR_OPTIONS.some(([color]) => lower.includes(color.toLowerCase()));
  if (asksToHighlight && !hasSupplier) return { reply: "Which vendor's parts should I highlight?", choices: ["Vendor-A", "Vendor-B", "Vendor-C"].map(vendor => ({ label: vendor, message: `Highlight ${vendor} parts` })) };
  if (asksToHighlight && !hasColor) return { reply: "Which highlight color would you like?", choices: COLOR_OPTIONS.map(([label, hex]) => ({ label, message: `${text} with color ${hex}` })) };

  const asksToExplode = lower.includes("explode");
  if (asksToExplode && !/\b(?:by|factor|to)\s*(?:of\s*)?[0-2](?:\.\d+)?\b/i.test(lower)) return { reply: "How far should I explode the assembly?", choices: [0, 0.5, 1, 1.5, 2].map(factor => ({ label: `Factor ${factor}`, message: `Explode assembly by ${factor}` })) };

  const asksForSection = lower.includes("cross section") || lower.includes("slice") || lower.includes("cut");
  const planes = ["XY", "YZ", "ZX"];
  const plane = planes.find(item => new RegExp(`\\b${item.toLowerCase()}\\b`, "i").test(lower));
  if (asksForSection && !plane) return { reply: "Which cross-section plane should I use?", choices: planes.map(item => ({ label: item, message: `Create a ${item} cross section` })) };
  if (asksForSection && !/\boffset\s*(?:of|to|at)?\s*-?\d+(?:\.\d+)?/i.test(lower)) return { reply: "What section offset should I use?", choices: [-2, -1, 0, 1, 2].map(offset => ({ label: `Offset ${offset}`, message: `Create a ${plane} cross section at offset ${offset}` })) };

  const views = ["isometric", "top", "bottom", "front", "right"];
  if (/\b(view|camera)\b/.test(lower) && !asksToExplode && !views.some(view => lower.includes(view))) return { reply: "Which camera view would you like?", choices: views.map(view => ({ label: view[0].toUpperCase() + view.slice(1), message: `Set view to ${view}` })) };
  return null;
}

export function parseLocalIntent(text) {
  const lower = text.toLowerCase();
  if (isResetRequest(text)) return [{ name: "reset_scene", args: {} }];
  const actions = [];
  if (lower.includes("explode")) { const match = lower.match(/\b([0-2](\.\d+)?)\b/); actions.push({ name: "generate_exploded_view", args: { explosionFactor: match ? parseFloat(match[1]) : 1.2 } }); }
  if (["isometric", "top", "bottom", "front", "right"].some(view => lower.includes(view))) { let preset = "Isometric"; if (lower.includes("top")) preset = "Top"; if (lower.includes("bottom")) preset = "Bottom"; if (lower.includes("front")) preset = "Front"; if (lower.includes("right")) preset = "Right"; actions.push({ name: "set_camera_view", args: { preset } }); }
  if (lower.includes("vendor") || lower.includes("highlight")) { let supplier = "Vendor-A"; if (lower.includes("vendor-b") || lower.includes("vendor b")) supplier = "Vendor-B"; if (lower.includes("vendor-c") || lower.includes("vendor c")) supplier = "Vendor-C"; const colorHex = COLOR_OPTIONS.find(([color]) => lower.includes(color.toLowerCase()))?.[1]; if (!colorHex) return null; actions.push({ name: "highlight_components", args: { filterCriteria: { supplier }, colorHex, isolateMode: false } }); }
  if (lower.includes("cross section") || lower.includes("slice") || lower.includes("cut")) { let plane = "ZX"; if (lower.includes("xy")) plane = "XY"; if (lower.includes("yz")) plane = "YZ"; const match = lower.match(/\boffset\s*(?:of|to|at)?\s*(-?\d+(?:\.\d+)?)/i); actions.push({ name: "create_cross_section", args: { plane, offsetDistance: match ? parseFloat(match[1]) : 0, enabled: true } }); }
  return actions.length ? actions : null;
}
