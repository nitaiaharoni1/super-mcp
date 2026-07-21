import type { Metadata } from "next";
import { Geist_Mono, Heebo, Secular_One } from "next/font/google";

import { he } from "@/content/he";

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

export const metadata: Metadata = {
  title: he.meta.title,
  description: he.meta.description,
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${secular.variable} ${heebo.variable} ${geistMono.variable}`}
    >
      <body className="min-h-[100dvh] antialiased">{children}</body>
    </html>
  );
}
