const LINKS = [
  { label: "Designs", href: "#designs" },
  { label: "Process", href: "#process" },
  { label: "Gallery", href: "#gallery" },
  { label: "About", href: "#about" },
];

// Fixed top bar. Starts invisible; HeroShell animates it in via the data attribute.
export default function Navbar() {
  return (
    <header
      data-intro="nav"
      className="invisible fixed inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5 md:px-12 md:py-7"
    >
      <a href="#top" className="font-display text-2xl tracking-wide text-[#F4F1E8] md:text-[1.7rem]">
        Treehouse <span className="italic text-[#D8B26A]">Life</span>
      </a>

      <nav aria-label="Primary" className="hidden items-center gap-10 md:flex">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="text-[0.8rem] uppercase tracking-[0.2em] text-[#F4F1E8]/80 transition-colors hover:text-[#D8B26A]"
          >
            {l.label}
          </a>
        ))}
      </nav>

      <a
        href="#contact"
        className="rounded-full border border-[#F4F1E8]/40 px-5 py-2 text-[0.75rem] uppercase tracking-[0.2em] text-[#F4F1E8] backdrop-blur-sm transition-colors hover:border-[#D8B26A] hover:bg-[#D8B26A] hover:text-[#1A2E0F]"
      >
        Enquire
      </a>
    </header>
  );
}
