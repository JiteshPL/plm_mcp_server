export const TOOL_DEFINITIONS = [
  { name: "reset_scene", description: "Restores the initial camera view and scene state.", inputSchema: { type: "object", properties: {} } },
  {
    name: "highlight_components", description: "Highlights CAD components by supplier in a selected color.",
    inputSchema: { type: "object", properties: { filterCriteria: { type: "object", properties: { supplier: { type: "string" } } }, colorHex: { type: "string" }, isolateMode: { type: "boolean" } }, required: ["colorHex"] }
  },
  { name: "set_camera_view", description: "Sets Isometric, Top, Bottom, Front, or Right camera view.", inputSchema: { type: "object", properties: { preset: { type: "string", enum: ["Isometric", "Top", "Bottom", "Front", "Right"] } }, required: ["preset"] } },
  { name: "generate_exploded_view", description: "Explodes or collapses assembly components.", inputSchema: { type: "object", properties: { explosionFactor: { type: "number", description: "Non-negative explosion distance multiplier; 0 resets positions." } }, required: ["explosionFactor"] } },
  { name: "create_cross_section", description: "Applies a dynamic cross-section plane.", inputSchema: { type: "object", properties: { plane: { type: "string", enum: ["XY", "YZ", "ZX"] }, offsetDistance: { type: "number" }, enabled: { type: "boolean" } }, required: ["plane", "enabled"] } }
];

export const COLOR_OPTIONS = [["Blue", "#0084ff"], ["Red", "#ff0000"], ["Green", "#00c853"], ["Yellow", "#ffd600"], ["Orange", "#ff6d00"], ["Purple", "#9c27b0"]];
