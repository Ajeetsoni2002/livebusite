import { useEffect, type RefObject } from "react";
export default function PaperParallax({
  scene,
}: {
  scene: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const node = scene.current;
    if (!node) return;
    const media = matchMedia(
      "(min-width: 900px) and (hover: hover) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      node.style.removeProperty("--scene-x");
      node.style.removeProperty("--scene-y");
    };
    const move = (event: PointerEvent) => {
      if (!media.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        node.style.setProperty(
          "--scene-x",
          `${((event.clientX - rect.left) / rect.width - 0.5) * 10}px`,
        );
        node.style.setProperty(
          "--scene-y",
          `${((event.clientY - rect.top) / rect.height - 0.5) * 8}px`,
        );
      });
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", reset);
    media.addEventListener("change", reset);
    return () => {
      reset();
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", reset);
      media.removeEventListener("change", reset);
    };
  }, [scene]);
  return null;
}
