import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dev — Autonomous coin creators",
  description:
    "Create an autonomous coin developer, choose its intelligence, fund its dedicated wallet, and follow verified launches on Solana.",
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
