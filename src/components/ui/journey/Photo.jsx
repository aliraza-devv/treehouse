import { JOURNEY_IMAGES } from "@/lib/journeyImages";

// One journey photo as a plain responsive <img> (the files are pre-sized webp, 800 and 1600 px wide).
// Width and height are the real ones, so the layout does not shift while it loads; below the fold they are
// lazy. The photo grade is a class (photo-grade, see globals.css) so every photo shares one look.
export default function Photo({ name, sizes = "(min-width: 1024px) 50vw, 100vw", eager = false, className = "", ...rest }) {
  const photo = JOURNEY_IMAGES[name];
  if (!photo) return null;
  return (
    <img
      src={`${photo.base}-1600.webp`}
      srcSet={`${photo.base}-800.webp 800w, ${photo.base}-1600.webp 1600w`}
      sizes={sizes}
      width={photo.w}
      height={photo.h}
      alt={photo.alt}
      aria-hidden={photo.alt ? undefined : "true"}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      style={{ objectPosition: photo.pos }}
      className={`photo-grade ${className}`}
      {...rest}
    />
  );
}
