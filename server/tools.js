export const TOOL_DEFINITIONS = [{
    name: "reset_scene",
    description: "Restores the initial camera view and scene state.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "highlight_components",
    description: "Highlights CAD components by supplier in a selected color.",
    inputSchema: {
      type: "object",
      properties: {
        filterCriteria: {
          type: "object",
          properties: {
            supplier: {
              type: "string"
            }
          }
        },
        colorHex: {
          type: "string"
        },
        isolateMode: {
          type: "boolean"
        }
      },
      required: ["colorHex"]
    }
  },
  {
    name: "set_camera_view",
    description: "Sets Isometric, Top, Bottom, Front, or Right camera view.",
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["Isometric", "Top", "Bottom", "Front", "Right"]
        }
      },
      required: ["preset"]
    }
  },
  {
    name: "generate_exploded_view",
    description: "Explodes or collapses assembly components. If the user does not specify a numeric factor, infer a sensible default from their wording.",
    inputSchema: {
      type: "object",
      properties: {
        explosionFactor: {
          type: "number",
          description: "Optional non-negative explosion distance multiplier; 0 resets positions."
        }
      }
    }
  },
  {
    name: "create_cross_section",
    description: "Applies a dynamic cross-section plane.",
    inputSchema: {
      type: "object",
      properties: {
        plane: {
          type: "string",
          enum: ["XY", "YZ", "ZX"]
        },
        offsetDistance: {
          type: "number"
        },
        enabled: {
          type: "boolean"
        }
      },
      required: ["plane", "enabled"]
    }
  },
  {
    name: "isolate_part",
    description:
        "Finds a CAD part by its part name, highlights it, and hides all other parts. Use this when the user asks to show, isolate, or highlight a specific part.",
    inputSchema: {
        type: "object",
        properties: {
            partName: {
                type: "string",
                description:
                    "Name of the CAD part to isolate."
            },
            colorHex: {
                type: "string",
                description:
                    "Highlight color in hexadecimal format, for example #ffd600."
            }
        },
        required: ["partName"]
    }
},
{
    name: "find_related_parts",
    description:
        "Find components spatially near a specified part. " +
        "Returns all components whose bounding boxes are within the specified distance.",

    inputSchema: {
        type: "object",
        properties: {
            partName: {
                type: "string",
                description: "Name of the reference part."
            },
            maxDistance: {
                type: "number",
                description:
                    "Maximum spatial distance from the part. " +
                    "Use 0 by default."
            }
        },
        required: ["partName"]
    }
}
];

export const COLOR_OPTIONS = [
  ["Blue", "#0084ff"],
  ["Red", "#ff0000"],
  ["Green", "#00c853"],
  ["Yellow", "#ffd600"],
  ["Orange", "#ff6d00"],
  ["Purple", "#9c27b0"]
];