import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S.",
  description:
    "Pure voice-only animated J.A.R.V.I.S. AI assistant with real-time Gemini Live audio, vision, and browser sensor telemetry.",
};

export const viewport: Viewport = {
  themeColor: "#02050b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full overflow-hidden">
      <body className="h-full w-full overflow-hidden bg-[#02050b] antialiased">
        {children}
      </body>
    </html>
  );
}
