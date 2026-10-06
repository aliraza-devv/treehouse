import Wordmark from "@/components/ui/Wordmark";
import { CTA_LABEL, ENQUIRY_HREF } from "@/lib/site";
import { Grain } from "./backdrops";

// THE FOOTER is the ground. The page climbs from the ground to the canopy, and it ends where the ladder above it stands:
// the page's green with a hand-drawn ground line along its top (a few blades of grass and two stones), and everything
// else sits under it, below the surface. There is no picture. The ladder in the invitation above has its foot on this
// line, and the way back up the tree is at the right, under it. The wordmark (with its leaf) and one line about what the
// company does are on the left; the four ways round the page are set large, as the headings are, instead of as a row
// of small links. The credits the licences ask for sit in the last line: the Pexels photographs, and the CC BY 4.0
// child model (its credit used to sit on the hero; it lives here, where it can be read).
//
// A server component: nothing here moves, and it needs no script.
const LINKS = [
  { label: "About", href: "#about" },
  { label: "Products", href: "#products" },
  { label: "Projects", href: "#projects" },
  { label: "Questions", href: "#faq" },
];

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-brand-forest">
      <Grain />

      {/* The ground line, with a few blades and two stones */}
      <svg aria-hidden="true" viewBox="0 0 1440 28" preserveAspectRatio="none" fill="none" strokeLinecap="round" className="pointer-events-none absolute inset-x-0 top-0 h-7 w-full overflow-visible">
        <path
          d="M0 6 C90 2 170 11 280 6 S470 1 590 7 S790 12 930 6 S1180 2 1300 7 S1400 9 1440 6"
          className="stroke-brand-cream/30"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M118 7 L114 -3 M126 7 L129 -5 M134 7 L139 -2 M402 5 L399 -4 M410 6 L413 -5 M646 8 L643 -1 M654 8 L657 -4 M1018 6 L1015 -3 M1027 6 L1030 -4 M1236 6 L1233 -3 M1244 6 L1248 -4 M1330 7 L1328 -2 M1338 7 L1341 -4"
          className="stroke-brand-cream/[0.22]"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M214 13 C216 9 224 9 226 13 C224 16 216 16 214 13 M760 14 C762 11 768 11 770 14 C768 17 762 17 760 14"
          className="stroke-brand-cream/[0.18]"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="relative mx-auto grid max-w-[1400px] gap-16 px-6 pt-[13vh] pb-16 md:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)_minmax(0,0.6fr)] lg:gap-12 lg:px-16">
        <div>
          <p className="font-display text-[clamp(2.4rem,3.8vw,3.6rem)] leading-none text-brand-cream">
            <Wordmark />
          </p>
          <p className="mt-6 max-w-[26rem] text-[17px] leading-relaxed text-pretty text-brand-cream/80">
            Treehouses, rope bridges, treetop walkways and nest swings, designed and built in the UK.
          </p>
          <a
            href={ENQUIRY_HREF}
            className="group focus-ring mt-8 inline-flex h-12 items-center gap-3 rounded-full border border-brand-cream/45 px-7 text-[15px] font-medium whitespace-nowrap text-brand-cream transition-[background-color,border-color,scale] duration-500 ease-expo-out hover:border-brand-cream hover:bg-brand-cream/10 active:scale-[0.98]"
          >
            {CTA_LABEL}
            <span aria-hidden="true" className="transition-transform duration-500 ease-expo-out group-hover:translate-x-1">
              →
            </span>
          </a>
        </div>

        <nav aria-label="Footer">
          <ul role="list" className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="focus-ring relative inline-block py-1 font-display text-[clamp(1.8rem,2.6vw,2.4rem)] leading-tight text-brand-cream after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:origin-left after:scale-x-0 after:bg-brand-warm after:transition-transform after:duration-500 after:ease-expo-out hover:after:scale-x-100 focus-visible:after:scale-x-100"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:justify-self-end">
          <a href="#top" className="group focus-ring inline-flex items-center gap-4 text-[15px] font-medium text-brand-cream">
            <span>Back to the top</span>
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-full border border-brand-cream/45 text-lg transition-[background-color,translate] duration-500 ease-expo-out group-hover:-translate-y-1 group-hover:bg-brand-cream/10"
            >
              ↑
            </span>
          </a>
        </div>
      </div>

      <div className="relative border-t border-brand-cream/10">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-6 py-6 text-xs leading-relaxed text-brand-cream/70 md:flex-row md:justify-between md:px-8 lg:px-16">
          <p>© {year} Treehouse Life</p>
          <p>
            Photography from{" "}
            <a href="https://www.pexels.com" className="focus-ring underline" target="_blank" rel="noopener noreferrer">
              Pexels
            </a>
            . Child model based on{" "}
            <a
              href="https://sketchfab.com/3d-models/fhc-crying-child-b60b17251195459e95c60d8992139a0c"
              className="focus-ring underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              FHC: Crying Child
            </a>{" "}
            by Speed F1, licensed under{" "}
            <a href="http://creativecommons.org/licenses/by/4.0/" className="focus-ring underline" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
