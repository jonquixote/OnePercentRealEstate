import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: 'OnePercent — Find Rental Properties That Cash Flow',
    template: '%s | OnePercent',
  },
  description: 'Discover 1% rule rental properties nationwide. Smart rent estimates, market analytics, and deal scoring for real estate investors.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'OnePercent',
    title: 'OnePercent — Find Rental Properties That Cash Flow',
    description: 'Smart rental property analysis for serious investors.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OnePercent — Find Rental Properties That Cash Flow',
    description: 'Smart rental property analysis for serious investors.',
  },
  robots: { index: true, follow: true },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          <Header />
          <div className="flex min-h-screen flex-col">
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
