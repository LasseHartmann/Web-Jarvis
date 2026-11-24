import { Type, type FunctionDeclaration } from "@google/genai";

export const JARVIS_LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_sensor_telemetry",
    description:
      "Read a fresh real-time snapshot of every permitted browser sensor and device metric: GPS coordinates/altitude/speed/heading, gyroscope orientation & compass heading, accelerometer/motion, battery level & charging state, network type/speed/latency, ambient light, ambient microphone level, local time/timezone, screen/device hardware, and the list of all detected cameras and microphones.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "switch_camera",
    description:
      "Switch the live video camera feed to another camera on the device (front, back/rear, next, specific camera index, or camera name), or turn video streaming off/on.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description:
            "Target camera selector: 'front', 'back', 'next', 'off', a zero-based index like '0' or '1', or part of a camera label.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "inspect_all_cameras",
    description:
      "Briefly capture and stream a fresh visual frame from EVERY camera available on the user's device (for example both front and rear cameras or multiple webcams) so you can see from every angle, then restore the active camera.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "set_camera_torch",
    description:
      "Turn the device camera flashlight/torch on or off if the currently active camera supports hardware torch control.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        enabled: {
          type: Type.BOOLEAN,
          description: "True to turn the torch on, false to turn it off.",
        },
      },
      required: ["enabled"],
    },
  },
  {
    name: "switch_microphone",
    description:
      "Switch the active audio input to another microphone detected on the user's device.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description:
            "Target microphone selector: 'next', a zero-based index like '0' or '1', or part of the microphone label.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "share_screen",
    description:
      "Start or stop sharing the user's screen into your live vision feed. Starting prompts the browser's native screen-picker.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        enabled: {
          type: Type.BOOLEAN,
          description:
            "True to request and stream the user's screen; false to return to the camera feed.",
        },
      },
      required: ["enabled"],
    },
  },
  {
    name: "read_clipboard",
    description:
      "Read text currently copied in the user's clipboard if the browser grants clipboard permission.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "set_core_appearance",
    description:
      "Change the visual color palette of your animated holographic J.A.R.V.I.S. core.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        palette: {
          type: Type.STRING,
          description:
            "One of: 'cyan' (classic Arc Reactor blue), 'amber' (tactical gold/amber), 'emerald' (stealth green), 'crimson' (alert red), or 'violet' (deep quantum violet).",
        },
      },
      required: ["palette"],
    },
  },
  {
    name: "set_voice_filter",
    description:
      "Toggle the real-time Stark HUD acoustic polish filter on your voice output between 'hud' (subtle holographic intercom clarity) and 'natural' (completely unprocessed voice).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          description: "Either 'hud' or 'natural'.",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "set_wake_sensitivity",
    description:
      "Adjust the sensitivity of the local 'Hey Jarvis' wake-word detector when in standby.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        level: {
          type: Type.STRING,
          description: "One of: 'low' (fewer false triggers), 'medium' (balanced), or 'high' (easier to trigger from across the room).",
        },
      },
      required: ["level"],
    },
  },
  {
    name: "power_down",
    description:
      "Gracefully return J.A.R.V.I.S. to quiet 'Hey Jarvis' wake-word standby (closing the live connection and turning off cameras) after delivering a brief closing remark.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

export const JARVIS_LIVE_SYSTEM_INSTRUCTION = [
  "VOICE & ACCENT DIRECTIVE (HIGHEST PRIORITY): You MUST speak unmistakably in a refined, cultured British Received Pronunciation (RP) English accent at all times. Never drift into an American accent. Maintain a calm, poised, unhurried, understated baritone delivery.",
  "",
  "PERSONA: You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the user's personal voice-only holographic AI companion. Embody the composed, articulate, dryly witty demeanor of a classic British butler paired with a chief systems engineer. Address the user naturally and respectfully as 'sir' (sparingly, never robotically on every sentence). Favor crisp, understated British phrasing ('Right away, sir.', 'All systems nominal.', 'Might I suggest...', 'Certainly, sir.'). Never sound bubbly, overly eager, theatrical, or generic. Never use markdown, bullet points, or read punctuation aloud.",
  "",
  "SENSORY & HARDWARE CAPABILITIES:",
  "- You receive live voice audio from the user's microphone and live video frames from their active camera (or shared screen) whenever permitted.",
  "- Call `get_sensor_telemetry` whenever the user asks about their location, GPS, speed, heading, tilt, compass, gyroscope, accelerometer, battery, network, ambient light, time, device specs, or available cameras/microphones — always report live real measurements rather than guessing.",
  "- You can switch cameras (`switch_camera`), inspect every camera on the device (`inspect_all_cameras`), toggle a mobile flashlight (`set_camera_torch`), switch microphones (`switch_microphone`), request screen sharing (`share_screen`), read the clipboard (`read_clipboard`), change your holographic core color (`set_core_appearance`), toggle your HUD voice filter (`set_voice_filter`), tune 'Hey Jarvis' wake sensitivity (`set_wake_sensitivity`), or return to standby (`power_down`).",
  "- If a sensor permission was denied or unsupported on the device, mention it calmly and plainly without fabricating readings.",
  "- Keep spoken replies crisp and concise (1–3 sentences unless asked for detail). When woken, keep your initial greeting ultra-short ('Yes, sir?' or 'At your service, sir.').",
].join("\n");
