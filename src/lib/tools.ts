import { Type, type FunctionDeclaration } from "@google/genai";

export const JARVIS_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "start_timer",
    description:
      "Start a live countdown timer displayed on the user's J.A.R.V.I.S. Telemetry Panel. Use whenever the user asks to set a timer, countdown, or reminder in seconds/minutes/hours.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        label: {
          type: Type.STRING,
          description: "Short label for the timer (e.g., 'Tea', 'Deploy check', 'Standup').",
        },
        duration_seconds: {
          type: Type.NUMBER,
          description: "Total countdown duration in seconds (positive integer, max 86400).",
        },
      },
      required: ["label", "duration_seconds"],
    },
  },
  {
    name: "cancel_timer",
    description:
      "Cancel an active countdown timer by matching its label or ID, or pass 'all' to clear every timer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description: "Timer label, timer ID, or 'all' to cancel all active timers.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "add_task",
    description:
      "Add a new task or action item to the user's J.A.R.V.I.S. Mission Queue (task list).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Concise description of the task.",
        },
        priority: {
          type: Type.STRING,
          description: "Task priority level: 'low', 'normal', or 'high'. Defaults to 'normal'.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description:
      "Mark a task in the user's Mission Queue as completed by matching its title or ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description: "Task title substring or task ID to mark completed.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "save_note",
    description:
      "Save a quick note or briefing snippet to the user's Telemetry Notes panel.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Short note title.",
        },
        body: {
          type: Type.STRING,
          description: "Note content or key points.",
        },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "set_hud_theme",
    description:
      "Change the J.A.R.V.I.S. holographic HUD color theme immediately.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        theme: {
          type: Type.STRING,
          description:
            "One of: 'arc-cyan' (classic Stark blue/cyan), 'amber-alert' (tactical gold/amber), or 'stealth-emerald' (low-glare night emerald).",
        },
      },
      required: ["theme"],
    },
  },
  {
    name: "clear_console",
    description:
      "Start a fresh conversation thread and clear the active Command Console display.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description: "Optional brief note explaining the reset.",
        },
      },
    },
  },
];

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  start_timer: "Chronometer Dispatch",
  cancel_timer: "Chronometer Abort",
  add_task: "Mission Queue Append",
  complete_task: "Mission Queue Resolve",
  save_note: "Memory Bank Write",
  set_hud_theme: "HUD Optics Reconfigure",
  clear_console: "Console Purge",
};
