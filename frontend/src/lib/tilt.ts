/**
 * One delegated pointer listener tilts any `[data-tilt]` element (small angle + light reflection).
 * Writes CSS variables inside an animation frame, so React never re-renders on pointer movement.
 * Skipped for touch/coarse pointers and prefers-reduced-motion.
 */
export function startTilt(maxDeg = 5) {
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (!fine.matches || reduced.matches) return () => {};
  let active: HTMLElement | null = null,
    frame = 0,
    x = 0,
    y = 0;
  const release = () => {
    if (!active) return;
    active.classList.remove("tilting");
    for (const name of ["--rx", "--ry", "--mx", "--my"])
      active.style.removeProperty(name);
    active = null;
  };
  const paint = () => {
    frame = 0;
    if (!active) return;
    const box = active.getBoundingClientRect();
    const px = (x - box.left) / box.width,
      py = (y - box.top) / box.height;
    active.style.setProperty(
      "--ry",
      `${((px - 0.5) * 2 * maxDeg).toFixed(2)}deg`,
    );
    active.style.setProperty(
      "--rx",
      `${((0.5 - py) * 2 * maxDeg).toFixed(2)}deg`,
    );
    active.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    active.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-tilt]",
    );
    if (target !== active) {
      release();
      active = target ?? null;
      active?.classList.add("tilting");
    }
    x = event.clientX;
    y = event.clientY;
    if (active && !frame) frame = requestAnimationFrame(paint);
  };
  const leave = (event: PointerEvent) => {
    if (!event.relatedTarget) release();
  };
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerout", leave, { passive: true });
  window.addEventListener("blur", release);
  return () => {
    cancelAnimationFrame(frame);
    release();
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerout", leave);
    window.removeEventListener("blur", release);
  };
}
