import type { Metadata } from "next";
import { Archivo_Black, Geist_Mono, Heebo, Secular_One } from "next/font/google";

import { he } from "@/content/he";
import { getSiteUrl } from "@/lib/mcp";

import "./globals.css";

const secular = Secular_One({
  weight: "400",
  subsets: ["hebrew", "latin"],
  variable: "--font-secular",
  display: "swap",
});

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/*
 * The wordmark gets its own face, used nowhere else on the page.
 *
 * Secular One was doing double duty as Hebrew display type and as the Latin
 * wordmark, and its Latin is unremarkable, so "Super MCP" looked like body text
 * in bold. Archivo Black is the blocky grotesque of shelf-edge signage: one
 * weight, one job, Latin only.
 */
const archivo = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-wordmark",
  display: "swap",
});

/**
 * Social card for WhatsApp, Slack, and X. `public/og.png` is the designed
 * thumbnail resized from `brand/og-source.jpg` (see `brand/README.md`).
 */
const SITE_URL = getSiteUrl();

/**
 * Share cards get the short subtitle (same line as on the thumbnail). Search and
 * `<meta name="description">` keep the longer description. Title matches the
 * hero / thumbnail headline so the preview, the image, and the page agree.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: he.meta.title,
  description: he.meta.description,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "he_IL",
    siteName: he.header.brand,
    title: he.meta.title,
    description: he.meta.subtitle,
    url: SITE_URL,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: `${he.meta.title}. ${he.meta.subtitle}`,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: he.meta.title,
    description: he.meta.subtitle,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${secular.variable} ${heebo.variable} ${geistMono.variable} ${archivo.variable}`}
    >
      <body className="min-h-[100dvh] antialiased">{children}</body>
    </html>
  );
}
