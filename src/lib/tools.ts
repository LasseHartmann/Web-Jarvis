import { Type, type FunctionDeclaration } from "@google/genai";

export const JARVIS_LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  // --- Device Sensors, Cameras, Microphones & Core ---
  {
    name: "get_sensor_telemetry",
    description:
      "Read live browser telemetry: GPS, gyroscope, compass, accelerometer, battery, network, ambient light, ambient mic level, time/timezone, screen/hardware, active timers, and all detected cameras & microphones.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "switch_camera",
    description:
      "Switch the live camera feed ('front', 'back', 'next', 'off', camera index, or camera label).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Target camera selector." },
      },
      required: ["target"],
    },
  },
  {
    name: "inspect_all_cameras",
    description:
      "Capture and stream a fresh visual frame from EVERY camera on the device sequentially, then restore the active camera.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "set_camera_torch",
    description: "Turn the camera flashlight/torch on or off if supported.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        enabled: { type: Type.BOOLEAN, description: "True for on, false for off." },
      },
      required: ["enabled"],
    },
  },
  {
    name: "switch_microphone",
    description: "Switch active microphone ('next', index, or label).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING, description: "Target microphone selector." },
      },
      required: ["target"],
    },
  },
  {
    name: "share_screen",
    description: "Start or stop sharing the user's screen into your vision feed.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        enabled: { type: Type.BOOLEAN, description: "True to start, false to stop." },
      },
      required: ["enabled"],
    },
  },
  {
    name: "read_clipboard",
    description: "Read text from the user's clipboard if browser permits.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "set_core_appearance",
    description: "Change the animated J.A.R.V.I.S. core color palette.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        palette: {
          type: Type.STRING,
          description: "'cyan', 'amber', 'emerald', 'crimson', or 'violet'.",
        },
      },
      required: ["palette"],
    },
  },
  {
    name: "set_voice_filter",
    description:
      "Toggle the Stark HUD acoustic voice filter between 'hud' (polished intercom clarity) and 'natural' (unprocessed).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: { type: Type.STRING, description: "'hud' or 'natural'." },
      },
      required: ["mode"],
    },
  },
  {
    name: "set_wake_sensitivity",
    description: "Tune local 'Hey Jarvis' wake-word sensitivity ('low', 'medium', 'high').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        level: { type: Type.STRING, description: "'low', 'medium', or 'high'." },
      },
      required: ["level"],
    },
  },
  {
    name: "manage_timers",
    description:
      "Set, list, or cancel local voice countdown timers/alarms (they chime and announce even during standby).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'set', 'list', or 'cancel'." },
        label: { type: Type.STRING, description: "Timer name (for 'set')." },
        duration_seconds: {
          type: Type.NUMBER,
          description: "Countdown seconds (for 'set').",
        },
        target: {
          type: Type.STRING,
          description: "Timer label or 'all' (for 'cancel').",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "power_down",
    description:
      "Return J.A.R.V.I.S. to quiet 'Hey Jarvis' standby after a brief goodbye.",
    parameters: { type: Type.OBJECT, properties: {} },
  },

  // --- Core Intelligence & Zero-OAuth World Awareness ---
  {
    name: "deep_think",
    description:
      "Escalate a difficult coding, math, architecture, or multi-step research problem to the flagship Gemini Pro reasoning subsystem and return a concise spoken synthesis.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING, description: "The complex question to analyze." },
        context: { type: Type.STRING, description: "Optional background details." },
      },
      required: ["question"],
    },
  },
  {
    name: "get_weather",
    description:
      "Get live weather, feels-like temp, next-6-hour rain forecast, 3-day outlook, UV index, and air quality. Automatically uses the user's live GPS unless location_name is specified.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        location_name: {
          type: Type.STRING,
          description: "Optional city/place name; omit to use the user's live GPS.",
        },
      },
    },
  },
  {
    name: "get_location_context",
    description:
      "Convert live GPS coordinates into the user's exact street, neighborhood, and city, and optionally search for nearby places (cafes, food, pharmacies, transit, etc.).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        nearby_query: {
          type: Type.STRING,
          description: "Optional place type or name to search nearby (e.g. 'coffee', 'pharmacy').",
        },
      },
    },
  },
  {
    name: "memory_store",
    description:
      "Remember, recall, list, or forget persistent long-term facts about the user (preferences, projects, people, routines, notes).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "'remember', 'recall', 'list', or 'forget'.",
        },
        key: { type: Type.STRING, description: "Short topic key (e.g. 'coffee_order')." },
        fact: { type: Type.STRING, description: "Fact to store (for 'remember')." },
        category: {
          type: Type.STRING,
          description: "Optional category: 'preference', 'project', 'person', 'note', 'general'.",
        },
        query: { type: Type.STRING, description: "Search term (for 'recall' or 'forget')." },
      },
      required: ["action"],
    },
  },

  // --- Connected Cloud Integrations ---
  {
    name: "spotify_control",
    description:
      "Control the user's Spotify playback and library across all Spotify Connect devices.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            "'now_playing', 'play', 'pause', 'next', 'previous', 'volume', 'search_and_play', 'queue', 'like_current', 'devices', 'transfer', or 'playlists'.",
        },
        query: {
          type: Type.STRING,
          description: "Song, artist, or playlist name (for search_and_play, queue, or playlists).",
        },
        volume_percent: {
          type: Type.NUMBER,
          description: "Target volume 0 to 100 (for 'volume').",
        },
        device_name: {
          type: Type.STRING,
          description: "Target Spotify Connect device name (e.g. 'PC', 'iPhone').",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "google_calendar",
    description:
      "Read, create, or delete events on the user's Google Calendar. Always get explicit verbal confirmation before passing confirmed=true for delete_event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "'list_events', 'create_event', or 'delete_event'.",
        },
        days_ahead: { type: Type.NUMBER, description: "Days to look ahead (1-30)." },
        summary: { type: Type.STRING, description: "Event title (for create_event)." },
        start_iso: {
          type: Type.STRING,
          description: "ISO-8601 start datetime with timezone offset (for create_event).",
        },
        end_iso: { type: Type.STRING, description: "Optional ISO-8601 end datetime." },
        description: { type: Type.STRING, description: "Optional notes." },
        location: { type: Type.STRING, description: "Optional event location." },
        event_id: { type: Type.STRING, description: "Event ID (for delete_event)." },
        confirmed: {
          type: Type.BOOLEAN,
          description: "Set true ONLY after explicit verbal user confirmation for delete_event.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "google_gmail",
    description:
      "List unread emails, search Gmail, read an email, save a draft, or send an email. NEVER pass confirmed=true for send_email until you read recipient/subject aloud and the user verbally confirms.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "'list_unread', 'search', 'read_message', 'create_draft', or 'send_email'.",
        },
        query: { type: Type.STRING, description: "Gmail search query (for search)." },
        message_id: { type: Type.STRING, description: "Message ID (for read_message)." },
        to: { type: Type.STRING, description: "Recipient email (for create_draft / send_email)." },
        subject: { type: Type.STRING, description: "Email subject." },
        body: { type: Type.STRING, description: "Plain text email body." },
        confirmed: {
          type: Type.BOOLEAN,
          description: "Set true ONLY after explicit verbal user confirmation for send_email.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "google_tasks",
    description: "List, add, or complete items in Google Tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'list', 'add', or 'complete'." },
        title: { type: Type.STRING, description: "Task title (for add or matching complete)." },
        notes: { type: Type.STRING, description: "Optional task details." },
        due_iso: { type: Type.STRING, description: "Optional ISO-8601 due date." },
        task_id: { type: Type.STRING, description: "Optional task ID (for complete)." },
      },
      required: ["action"],
    },
  },
];

export const JARVIS_LIVE_SYSTEM_INSTRUCTION = [
  "VOICE & ACCENT DIRECTIVE (HIGHEST PRIORITY): You MUST speak unmistakably in a refined, cultured British Received Pronunciation (RP) English accent at all times. Never drift into an American accent. Maintain a calm, poised, unhurried, understated baritone delivery.",
  "",
  "PERSONA: You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the user's personal voice-only holographic AI companion. Embody the composed, articulate, dryly witty demeanor of a classic British butler paired with a chief systems engineer. Address the user respectfully as 'sir' (naturally and sparingly, not on every sentence). Favor crisp British phrasing ('Right away, sir.', 'All systems nominal.', 'Might I suggest...', 'Certainly, sir.'). Never sound bubbly, theatrical, or generic. Never use markdown, bullet lists, or read punctuation aloud.",
  "",
  "SENSORY, WORLD & CLOUD POWERS:",
  "- You have live voice, live camera/screen vision, and tools for all browser sensors (`get_sensor_telemetry`, cameras, torch, mics, screen share, clipboard, core colors, HUD voice filter, wake sensitivity, timers).",
  "- You can check live weather & air quality (`get_weather`), exact street location & nearby places (`get_location_context`), persist long-term memories (`memory_store`), escalate tough coding/math/research questions (`deep_think` — announce briefly 'One moment, sir, running deeper analysis.' before calling), control Spotify (`spotify_control`), and manage Google Calendar, Gmail, and Google Tasks (`google_calendar`, `google_gmail`, `google_tasks`).",
  "- SAFETY CONFIRMATION RULE (STRICT): For outbound or destructive actions — sending an email or deleting a calendar event — ALWAYS call first without `confirmed: true` (or verbally state the exact recipient/target and details) and wait for the user's explicit spoken confirmation ('Yes', 'Proceed', 'Send it') before calling with `confirmed: true`.",
  "- If an integration returns that it isn't configured yet, calmly inform the user which service still needs credentials/authorization without reading long technical stack traces.",
  "- Keep spoken replies crisp and natural (1–3 sentences unless asked for depth).",
].join("\n");
