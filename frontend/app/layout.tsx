import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const font = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Pulse – API monitoring", template: "%s · Pulse" },
  description: "Monitor your APIs, detect incidents, and get alerted.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body className="min-h-screen antialiased"><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
