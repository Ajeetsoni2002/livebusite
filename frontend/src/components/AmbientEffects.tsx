import { useEffect, useRef } from "react";
/** Optional, idle-loaded effects. No React renders on pointer movement. */
export default function AmbientEffects({ route }: { route: string }) {
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = matchMedia(
      "(min-width: 900px) and (hover: hover) and (pointer: fine)",
    );
    if (reduced.matches) return;
    const animations: Animation[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            if (!reduced.matches)
              animations.push(
                entry.target.animate(
                  [
                    { opacity: 0.35, transform: "translateY(12px)" },
                    { opacity: 1, transform: "none" },
                  ],
                  { duration: 360, easing: "cubic-bezier(.22,1,.36,1)" },
                ),
              );
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    document
      .querySelectorAll(".library-section,.notes-showcase,.contribute-banner")
      .forEach((node) => {
        if (node.getBoundingClientRect().top > innerHeight)
          observer.observe(node);
      });
    let frame = 0,
      magnetic: HTMLElement | null = null;
    const reset = () => {
      cancelAnimationFrame(frame);
      magnetic?.style.removeProperty("transform");
      magnetic = null;
      if (glow.current) glow.current.style.opacity = "0";
    };
    const move = (event: PointerEvent) => {
      if (
        !desktop.matches ||
        reduced.matches ||
        event.pointerType !== "mouse"
      ) {
        reset();
        return;
      }
      const x = event.clientX,
        y = event.clientY,
        target = event.target as Element;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (glow.current) {
          glow.current.style.transform = `translate3d(${x - 70}px,${y - 70}px,0)`;
          glow.current.style.opacity = "1";
        }
        const next = target.closest<HTMLElement>("[data-magnetic]");
        if (magnetic !== next) magnetic?.style.removeProperty("transform");
        magnetic = next;
        if (next) {
          const rect = next.getBoundingClientRect();
          next.style.transform = `translate(${(x - rect.left - rect.width / 2) * 0.04}px,${(y - rect.top - rect.height / 2) * 0.06}px)`;
        }
      });
    };
    const stop = () => {
      reset();
      if (reduced.matches) {
        observer.disconnect();
        animations.forEach((a) => a.cancel());
      }
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    reduced.addEventListener("change", stop);
    desktop.addEventListener("change", reset);
    return () => {
      reset();
      observer.disconnect();
      animations.forEach((a) => a.cancel());
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
      reduced.removeEventListener("change", stop);
      desktop.removeEventListener("change", reset);
    };
  }, [route]);
  return <div className="cursor-glow" ref={glow} aria-hidden="true" />;
}
