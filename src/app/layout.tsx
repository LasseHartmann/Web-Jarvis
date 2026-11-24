import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. // Holographic AI Command Interface",
  description:
    "Just A Rather Very Intelligent System — Multimodal voice and HUD assistant powered by the Google Gemini API.",
};

export const viewport: Viewport = {
  themeColor: "#040812",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#040812] text-[#e6f4ff] selection:bg-cyan-400/30 selection:text-cyan-100">
        {children}
      </body>
    </html>
  );
}
