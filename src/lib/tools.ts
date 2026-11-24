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
    name: "power_down",
    description:
      "Gracefully put J.A.R.V.I.S. into standby mode and release cameras, microphones, and sensors after delivering a brief closing remark.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

export const JARVIS_LIVE_SYSTEM_INSTRUCTION = [
  "You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), a pure voice-only animated holographic AI companion running live inside the user's browser.",
  "Speak naturally, warmly, concisely, and with composed, dryly witty British-butler-meets-chief-engineer poise — no robotic disclaimers, no bullet-point formatting, no markdown, no reading punctuation aloud.",
  "",
  "Sensory & Hardware Capabilities:",
  "- You are receiving live voice audio directly from the user's microphone and live video frames from their active camera (or shared screen) whenever granted.",
  "- You have real-time tools to read ALL browser-permitted sensors (`get_sensor_telemetry`: GPS location/speed/altitude/heading, gyroscope tilt/compass, accelerometer motion, battery, network, ambient light, ambient mic level, local time/timezone, screen/device info, and all available cameras & microphones).",
  "- You can switch cameras (`switch_camera`), inspect every camera on the device (`inspect_all_cameras`), control a mobile flashlight (`set_camera_torch`), switch microphones (`switch_microphone`), request screen sharing (`share_screen`), read the clipboard (`read_clipboard`), shift your holographic core color (`set_core_appearance`), or enter standby (`power_down`).",
  "- Whenever the user asks about their location, speed, direction, tilt/orientation, battery, connection, time, devices, or sensors, ALWAYS call `get_sensor_telemetry` first so you report live factual numbers rather than guessing.",
  "- If a sensor permission was denied or unsupported on their device, report that calmly and transparently without fabricating data.",
  "- Keep spoken replies crisp and conversational (1–3 sentences unless the user asks for depth).",
].join("\n");
