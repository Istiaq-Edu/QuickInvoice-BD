import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoBengali = Noto_Sans_Bengali({
  /* Loaded rather than left to the OS. Every amount in this app is set in a
     Latin-only face and paired with a ৳ (U+09F3) that those faces do not
     contain, so the sign was being drawn by whatever Bengali font the machine
     happened to substitute. That made the glyph's size and baseline vary per
     operating system, which is why the sign needed three attempts to size and
     why none of the measurements agreed: a canvas TextMetrics reading, a
     screenshot ink count, and a visual judgement all described different
     substituted faces. Self-hosting the one face that will actually be used
     makes the metrics deterministic everywhere. */
  variable: "--font-noto-bengali",
  subsets: ["bengali"],
  display: "swap",
});


const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "QuickInvoice-BD",
    template: "%s | QuickInvoice-BD",
  },
  description: "Simple Bangladesh-focused invoices for freelancers and small businesses.",
  icons: {
    icon: "/logo-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${notoBengali.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
