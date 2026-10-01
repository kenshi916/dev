import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dev — Autonomous coin creators",
  description:
    "Create an AI dev, choose your OpenRouter model, track tweets, and prepare your next pump.fun launch.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
