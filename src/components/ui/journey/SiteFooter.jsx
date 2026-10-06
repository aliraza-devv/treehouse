// The end of the page: one line about what the company does, and the credits the licences ask for (the Pexels
// photographs, and the CC BY 4.0 child model, which the stage also credits until the page scrolls over it).
export default function SiteFooter() {
  return (
    <footer className="relative px-6 pt-[14vh] pb-8 md:px-8 lg:px-16">
      <div className="flex flex-col gap-3 border-t border-brand-cream/10 pt-6 text-xs leading-relaxed text-brand-cream/55 md:flex-row md:justify-between">
        <p>Treehouses, rope bridges, treetop walkways and nest swings, designed and built in the UK.</p>
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
    </footer>
  );
}
