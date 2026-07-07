import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FloatingNav } from "./components/FloatingNav";
import { BrainProvider } from "./lib/BrainProvider";

// Runs before first paint: apply the saved theme (or fall back to the OS setting)
// by toggling the `.dark` class on <html>, so there's no light-mode flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BrainQuest",
  description: "Turn your vault vault into a spaced-repetition learning game.",
};

// M3 (mobile shell): draw under the status bar / notch (`viewport-fit=cover`) — globals.css then adds
// safe-area padding so the floating nav and content stay clear of it. themeColor tints the status bar.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#09090c" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <BrainProvider>
          <FloatingNav />
          {children}
        </BrainProvider>
      </body>
    </html>
  );
}
