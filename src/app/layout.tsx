import type { Metadata } from "next";
import {
  Anton,
  IBM_Plex_Mono,
  Montserrat,
  Outfit,
  Poppins,
  Rajdhani,
} from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Caption fonts — used by the clipper wizard's style previews. Mirror the
// renderer's workers/remotion fonts (impact renders as Anton, same shapes).
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: ["400"],
});
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["700", "800"],
});
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "800"],
});
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["700", "800"],
});
const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: {
    default: "SIFT",
    template: "%s · SIFT",
  },
  description:
    "AI-powered video clipping tool — turn long-form content into viral short-form clips.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
    other: { url: "/icon.png", type: "image/png" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plexMono.variable} ${anton.variable} ${montserrat.variable} ${poppins.variable} ${outfit.variable} ${rajdhani.variable} font-sans antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
