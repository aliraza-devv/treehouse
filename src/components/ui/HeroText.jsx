// Each headline line sits in an overflow-hidden mask so it can rise into view.
function Line({ children }) {
  return (
    <span className="block overflow-hidden whitespace-nowrap pb-[0.12em]">
      <span data-intro="line" className="block translate-y-[110%]">
        {children}
      </span>
    </span>
  );
}

export default function HeroText() {
  return (
    <div
      data-hero-text
      className="relative z-20 flex min-h-svh flex-col justify-end px-6 pb-36 md:justify-center md:px-12 md:pb-0 lg:px-20"
    >
      <div className="max-w-2xl">
        <p
          data-intro="eyebrow"
          className="invisible mb-6 text-[0.72rem] uppercase tracking-[0.35em] text-[#D8B26A]"
        >
          Bespoke treehouses, designed and built in the UK
        </p>

        <h1 className="font-display text-[2.6rem] font-light leading-[0.98] text-[#F4F1E8] sm:text-7xl lg:text-[5.4rem]">
          <Line>From Forest Floor</Line>
          <Line>
            to <span className="italic text-[#E3C98A]">Canopy</span>
          </Line>
        </h1>

        <p
          data-intro="sub"
          className="invisible mt-7 max-w-md text-base leading-relaxed text-[#F4F1E8]/80 md:text-lg"
        >
          We design and build luxury treehouses that sit quietly in the trees and feel like the
          best room you have ever slept in.
        </p>

        <div data-intro="cta" className="invisible mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#contact"
            className="rounded-full bg-[#D8B26A] px-8 py-3.5 text-[0.78rem] font-medium uppercase tracking-[0.2em] text-[#1A2E0F] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[#E3C98A]"
          >
            Start Your Project
          </a>
          <a
            href="#gallery"
            className="rounded-full border border-[#F4F1E8]/40 px-8 py-3.5 text-[0.78rem] uppercase tracking-[0.2em] text-[#F4F1E8] backdrop-blur-sm transition-colors hover:border-[#F4F1E8]"
          >
            View Our Work
          </a>
        </div>
      </div>
    </div>
  );
}
