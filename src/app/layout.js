import { Cormorant_Garamond, Inter } from "next/font/google";
import { LAYERS } from "@/lib/layers";
import { BRAND } from "@/lib/sceneConfig";
import "./globals.css";

// Serif display face for the logo and heading. Only the weight in use is loaded.
const display = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

// UI sans for links, buttons, subline and stats.
const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  metadataBase: new URL("https://treehouselife.com"),
  alternates: { canonical: "/" },
  title: "Treehouse Life | Luxury Treehouse Design and Build",
  description:
    "Award-winning treehouse, rope bridge and treetop walkway builders. Bespoke treehouses designed and built in the UK for private gardens, estates, resorts and schools.",
  openGraph: {
    title: "Treehouse Life | Luxury Treehouse Design and Build",
    description: "Some memories are built, not bought. Bespoke treehouses designed and built in the UK.",
    siteName: "Treehouse Life",
    type: "website",
    locale: "en_GB",
  },
};

export const viewport = {
  themeColor: BRAND.forest,
  colorScheme: "dark",
};

// Without JavaScript the GSAP reveal never runs, so show the hero text as is.
const NOSCRIPT_CSS = "[data-intro]{opacity:1!important;visibility:visible!important;transform:none!important}";

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${sans.variable} antialiased`}>
      <head>
        <noscript>
          <style>{NOSCRIPT_CSS}</style>
        </noscript>
      </head>
      <body className="bg-brand-forest font-sans text-brand-cream">
        <a href="#main" className="skip-link focus-ring" style={{ zIndex: LAYERS.skip }}>
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
