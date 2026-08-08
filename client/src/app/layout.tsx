import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Logo } from "@/components/logo";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Contribly",
    template: "%s · Contribly",
  },
  description:
    "AI-powered recommendations for your next open-source contribution, matched to your stack and learning goals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <SiteNav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
          {children}
        </main>
        <footer className="border-t border-black/10 px-6 py-6 dark:border-white/15">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-2.5 text-sm opacity-60">
            <Logo variant="mark" label={null} className="h-3 w-auto" />
            <p>Contribly — find your next open-source contribution.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
