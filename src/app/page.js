import HeroShell from "@/components/ui/HeroShell";
import SmoothScroll from "@/components/ui/SmoothScroll";

export default function Home() {
  return (
    <main>
      <SmoothScroll />
      <HeroShell />
      {/* Scroll runway for the camera journey. Later sections replace this spacer. */}
      <div aria-hidden="true" className="h-[120svh]" />
    </main>
  );
}
