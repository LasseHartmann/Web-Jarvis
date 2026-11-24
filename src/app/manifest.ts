import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "J.A.R.V.I.S.",
    short_name: "J.A.R.V.I.S.",
    description:
      "Voice-only holographic AI companion powered by Google Gemini Live.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#02050b",
    theme_color: "#02050b",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
