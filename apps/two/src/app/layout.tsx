import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "two.octavo.press — Pro Terminal",
  description:
    "Pro analytics terminal for serious real-estate investors.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
