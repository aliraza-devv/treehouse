import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata = {
  title: "Treehouse Life | Luxury Treehouse Design and Build",
  description: "Bespoke treehouses designed and built in the UK. From forest floor to canopy.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} antialiased`}
    >
      <body className="bg-[#0d1708] font-sans text-[#F4F1E8]">{children}</body>
    </html>
  );
}
