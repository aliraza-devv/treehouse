import { Caveat, Figtree, Fraunces } from "next/font/google";
import { LAYERS } from "@/lib/layers";
import { BRAND } from "@/lib/sceneConfig";
import "./globals.css";

// Display face for the logo and every heading: Fraunces, the variable "soft serif", set at its display optical size
// (opsz 144), heavy, with the SOFT and WONK axes on (see .font-display in globals.css). That gives the look of the
// owner's references (Briston, Clara): a heavy, high-contrast vintage serif with soft ball terminals and a little
// lean in the h, n and m. Briston itself is a paid font; this is the closest free one. Do not use it for small text.
const display = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

// Handwriting accent, used ONLY for the small margin notes and captions in Section 3 (font-hand). One weight.
const hand = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

// Body and UI face: Figtree, a friendly, very legible geometric sans that sits well next to the heavy serif.
const sans = Figtree({
  variable: "--font-figtree",
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
    <html lang="en-GB" className={`${display.variable} ${sans.variable} ${hand.variable} antialiased`}>
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
