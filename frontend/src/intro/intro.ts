import "./intro.css";
import { introConfig as config } from "./config";
import { dotMatrix } from "./dotmatrix";
import { createIntroAudio, type IntroAudio } from "./audio";

/**
 * "The Exam Archive Opens": a self-contained, framework-free intro overlay.
 * One requestAnimationFrame loop drives the timeline and writes straight to the DOM;
 * nothing here touches React state.
 */
export type IntroHandle = {
  /** Jump to the exit (tear) animation. */
  skip(): void;
  /** Resolves once the overlay is removed and the page is unlocked. */
  done: Promise<void>;
  /** Exposed for verification only. */
  audio: IntroAudio | null;
};

// Timeline (seconds).
const T = {
  boardSet: 0.7,
  yearsStart: 1.2,
  yearsEnd: 2.95,
  subjectsStart: 1.3,
  subjectsEnd: 3.3,
  countStart: 0.35,
  countEnd: 3.35,
  scan: 3.45,
  scanDur: 0.95,
  fillStart: 3.82,
  fillDur: 0.7,
  named: 4.5,
  stamp: 4.78,
  /** Still moment after the stamp shake: clone + cut the paper for the tear. */
  prepareTear: 5.28,
  exit: 5.42,
  tearDur: 1.15,
};
const POP = 0.18;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
const easeInOut = (v: number) =>
  v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
const pad = (s: string, n: number) => s.slice(0, n).padEnd(n, " ");

/* ---------------- Split-flap cells ---------------- */
// Each cell: static top (new) + bottom (old), a top leaf (old) falling away and a bottom leaf (new)
// falling into place. The two leaf animations are created once and replayed on every flip;
// characters are swapped by editing text nodes in place.
type Cell = {
  value: string;
  flipping: boolean;
  top: Text;
  bot: Text;
  leafA: Text;
  leafB: Text;
  a: Animation;
  b: Animation;
};
function makeCell(initial: string): [HTMLElement, Cell] {
  const node = el("div", "pq-cell");
  const half = (cls: string) => {
    const h = el("div", `pq-half ${cls}`),
      s = el("span"),
      t = document.createTextNode(initial);
    s.append(t);
    h.append(s);
    node.append(h);
    return [h, t] as const;
  };
  const [, top] = half("pq-top"),
    [, bot] = half("pq-bot"),
    [leafAEl, leafA] = half("pq-top pq-leaf"),
    [leafBEl, leafB] = half("pq-bot pq-leaf");
  const a = leafAEl.animate(
    [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }],
    { duration: 100, easing: "cubic-bezier(.5,0,1,.6)", fill: "both" },
  );
  const b = leafBEl.animate(
    [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }],
    { duration: 100, easing: "cubic-bezier(0,.4,.4,1.25)", fill: "both" },
  );
  a.cancel();
  b.cancel();
  const cell: Cell = { value: initial, flipping: false, top, bot, leafA, leafB, a, b };
  b.onfinish = () => settle(cell);
  return [node, cell];
}
function settle(cell: Cell) {
  cell.bot.data = cell.value;
  cell.leafA.data = cell.value;
  cell.a.cancel();
  cell.b.cancel();
  cell.flipping = false;
}
/** Returns true when the character actually changed. */
function flipCell(cell: Cell, next: string, dur: number, delay: number) {
  if (cell.value === next) return false;
  if (cell.flipping) settle(cell);
  const prev = cell.value;
  cell.value = next;
  cell.flipping = true;
  cell.top.data = next;
  cell.bot.data = prev;
  cell.leafA.data = prev;
  cell.leafB.data = next;
  const half = dur / 2;
  cell.a.effect!.updateTiming({ duration: half, delay });
  cell.b.effect!.updateTiming({ duration: half, delay: delay + half });
  cell.a.play();
  cell.b.play();
  return true;
}
function flipRow(cells: Cell[], text: string, dur: number, stagger: number) {
  let changed = 0;
  const chars = [...pad(text, cells.length)];
  cells.forEach((c, i) => {
    if (flipCell(c, chars[i], dur, i * stagger)) changed++;
  });
  return changed;
}

/* ---------------- Drifting question papers ---------------- */
function paperTexture(seed: number) {
  const w = 120,
    h = 164,
    c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9d6f2";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#33415f";
  g.fillRect(14, 10, w - 28, 5);
  g.fillRect(34, 19, w - 68, 3);
  g.fillRect(10, 27, w - 20, 1);
  g.font = "bold 7px sans-serif";
  let y = 38,
    q = 1,
    r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280), r / 233280);
  while (y < h - 10) {
    g.fillStyle = "#1e2a46";
    g.fillText(`Q${q++}.`, 9, y + 3);
    const lines = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < lines && y < h - 10; i++, y += 7)
      g.fillRect(i ? 18 : 24, y, (w - 34) * (0.45 + rand() * 0.55), 2.4);
    y += 6;
  }
  return c.toDataURL("image/png");
}
type Drifter = {
  node: HTMLElement;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  vr: number;
  depth: number;
  h: number;
};

/* ---------------- OMR grid ---------------- */
type Bubble = { x: number; y: number; start: number; angle: number; done: boolean };
function omrLayout(vw: number, vh: number) {
  const maxW = Math.min(vw - 32, 980),
    maxH = vh * (vw < 640 ? 0.36 : 0.4);
  const fit = (lines: string[]) => {
    const g = dotMatrix(lines);
    const pitch = Math.min(
      maxW / (g.cols + 4),
      maxH / (g.rows + 4),
      vw < 640 ? 13 : 17,
    );
    return { g, pitch };
  };
  let best = fit([config.bubbleText]);
  const words = config.bubbleText.split(/\s+/);
  if (best.pitch < 9 && words.length > 1) {
    const stacked = fit(words);
    if (stacked.pitch > best.pitch) best = stacked;
  }
  return best;
}

/* ---------------- Main ---------------- */
export function playIntro(): IntroHandle {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const html = document.documentElement;
  const root = el("div", "pq-root");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", `${config.siteName} intro`);

  // public/theme.js hides the prerendered page before first paint; the overlay takes over from here.
  if (html.hasAttribute("data-pq-boot")) {
    html.removeAttribute("data-pq-boot");
    html.style.visibility = "";
    html.style.backgroundColor = "";
  }

  // Lock the page underneath: no scroll, no focus, no work.
  const prevOverflow = html.style.overflow,
    prevGutter = html.style.scrollbarGutter;
  html.style.overflow = "hidden";
  html.style.scrollbarGutter = "stable";
  const inerted: HTMLElement[] = [];
  for (const child of Array.from(document.body.children))
    if (child instanceof HTMLElement && !child.inert) {
      child.inert = true;
      inerted.push(child);
    }
  // The scroll lock keeps the scrollbar gutter reserved (no layout shift); while covered it shows
  // the page canvas, so tint that to the intro's ink.
  const prevBackground = html.style.backgroundColor;
  const setCover = (state: "cover" | "reveal" | null) => {
    html.style.backgroundColor = state === "cover" ? "#070b16" : prevBackground;
    if (state) html.dataset.pqIntro = state;
    else delete html.dataset.pqIntro;
    window.dispatchEvent(new Event("pq-intro"));
  };
  setCover("cover");
  let unlocked = false;
  const unlockPage = () => {
    if (unlocked) return;
    unlocked = true;
    html.style.overflow = prevOverflow;
    html.style.scrollbarGutter = prevGutter;
    for (const child of inerted) child.inert = false;
    setCover("reveal");
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const finish = () => {
    unlockPage();
    root.remove();
    setCover(null);
    resolveDone();
  };

  const name = el("div", "pq-name");
  name.append(
    el("span", "pq-name-glow", config.siteName),
    el("span", "pq-name-text", config.siteName),
  );
  const tagline = el("div", "pq-tagline", config.tagline);
  tagline.append(el("small", undefined, config.university));

  /* ---- Reduced motion: a short fade with the name ---- */
  if (reduced) {
    root.classList.add("pq-is-reduced");
    const wrap = el("div");
    wrap.append(name, tagline);
    root.append(wrap);
    document.body.append(root);
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      root.classList.add("pq-is-gone");
      unlockPage();
      setTimeout(finish, 520);
    };
    const timer = setTimeout(leave, 450);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") leave();
    };
    window.addEventListener("keydown", key);
    root.addEventListener("click", leave);
    void done.then(() => {
      clearTimeout(timer);
      window.removeEventListener("keydown", key);
    });
    return { skip: leave, done, audio: null };
  }

  const vw = window.innerWidth,
    vh = window.innerHeight,
    narrow = vw < 640,
    year = new Date().getFullYear();

  /* ---- Build the paper ---- */
  const sheet = el("div", "pq-sheet");

  // Drifting question papers (rendered once to small images; the browser's upscale softens them).
  const drift = el("div", "pq-drift");
  const textures = [1, 2, 3].map(paperTexture);
  const drifters: Drifter[] = [];
  const count = narrow ? 4 : 8;
  for (let i = 0; i < count; i++) {
    const node = el("div", "pq-paper");
    const depth = 0.35 + (i / count) * 0.9;
    const w = (narrow ? 110 : 150) * (0.7 + depth * 0.7),
      h = w * 1.37;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    node.style.backgroundImage = `url(${textures[i % 3]})`;
    node.style.opacity = String(0.05 + depth * 0.07);
    drift.append(node);
    drifters.push({
      node,
      x: ((i + 0.5) / count) * vw + (Math.random() - 0.5) * vw * 0.12 - w / 2,
      y: Math.random() * (vh + h) - h,
      r: (Math.random() - 0.5) * 50,
      vx: (Math.random() - 0.5) * 10,
      vy: -(10 + depth * 22),
      vr: (Math.random() - 0.5) * 8,
      depth,
      h,
    });
  }

  // Frame and exam-paper corner details.
  const frame = el("div", "pq-frame");
  for (const c of ["tl", "tr", "bl", "br"])
    frame.append(el("i", `pq-tick pq-tick-${c}`));
  const tl = el("div", "pq-corner pq-corner-tl");
  tl.innerHTML = `<span class="pq-dot"></span><span><b></b> · EXAMINATION ARCHIVE</span>`;
  tl.querySelector("b")!.textContent = narrow
    ? config.universityShort
    : config.university;
  const tr = el("div", "pq-corner pq-corner-tr");
  tr.innerHTML = `PAPER CODE: <b>PYQ-${year}</b>`;
  const bl = el("div", "pq-corner pq-corner-bl", "ROLL NO.");
  const roll = el("span", "pq-roll");
  for (const ch of `${String(year).slice(2)}${config.universityShort}0042`.slice(
    0,
    narrow ? 8 : 10,
  ))
    roll.append(el("span", undefined, ch));
  bl.append(roll);
  const br = el(
    "div",
    "pq-corner pq-corner-br",
    "TIME ALLOWED: 06.5 SEC · MAX. MARKS: 100",
  );
  frame.append(tl, tr, bl, br);

  // Split-flap board.
  const stage = el("div", "pq-stage");
  const board = el("div", "pq-board");
  const head = el("div", "pq-board-head");
  head.append(el("span", undefined, `${config.universityShort} · PREVIOUS YEAR PAPERS`));
  const live = el("span", undefined, "INDEXING");
  live.prepend(el("span", "pq-dot"));
  head.append(live);
  const yearRow = el("div", "pq-row pq-row-year"),
    subjectRow = el("div", "pq-row pq-row-subject");
  yearRow.append(el("div", "pq-row-label", "SESSION"));
  subjectRow.append(el("div", "pq-row-label", "COURSE / SUBJECT"));
  const yearCells: Cell[] = [],
    subjectCells: Cell[] = [];
  const yearBox = el("div", "pq-cells"),
    subjectBox = el("div", "pq-cells");
  for (let i = 0; i < 4; i++) {
    const [node, cell] = makeCell(" ");
    yearBox.append(node);
    yearCells.push(cell);
  }
  for (let i = 0; i < 16; i++) {
    const [node, cell] = makeCell(" ");
    subjectBox.append(node);
    subjectCells.push(cell);
  }
  yearRow.append(yearBox);
  subjectRow.append(subjectBox);
  board.append(head, yearRow, subjectRow);

  // OMR sheet.
  const omr = el("div", "pq-omr");
  const omrHead = el("div", "pq-omr-head");
  omrHead.append(
    el("span", undefined, "OMR ANSWER SHEET"),
    el("span", undefined, narrow ? "HB PENCIL ONLY" : "USE HB PENCIL ONLY · DARKEN FULLY"),
  );
  const { g: dots, pitch } = omrLayout(vw, vh);
  const gcols = dots.cols + 4,
    grows = dots.rows + 4;
  const gw = gcols * pitch,
    gh = grows * pitch;
  const grid = el("div", "pq-grid");
  grid.style.width = `${gw}px`;
  grid.style.height = `${gh}px`;
  omrHead.style.width = `${gw}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const mkCanvas = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(gw * dpr);
    c.height = Math.round(gh * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    grid.append(c);
    return [c, g] as const;
  };
  const [baseCanvas, base] = mkCanvas(),
    [, fx] = mkCanvas();
  const radius = pitch * 0.34;
  const stamp = el("div", "pq-stamp", config.stamp);
  stamp.append(el("small", undefined, config.stampSub));
  grid.append(name, stamp, tagline);
  omr.append(omrHead, grid);
  stage.append(board, omr);

  // Index counter.
  const index = el("div", "pq-index");
  const line = el("div", "pq-index-line");
  const countEl = el("span", "pq-count", "0000");
  line.append(el("span", undefined, "Indexing papers…"), countEl);
  const bar = el("div", "pq-bar"),
    barFill = el("i");
  bar.append(barFill);
  index.append(line, bar);

  const beam = el("div", "pq-beam");
  sheet.append(drift, frame, stage, index, beam);

  // Chrome: sound pill / toggle and skip hint (outside the paper, so it never tears).
  const chrome = el("div", "pq-chrome");
  const sound = el("button", "pq-sound");
  sound.type = "button";
  const soundIcon = el("span", "pq-sound-icon"),
    soundLabel = el("span");
  sound.append(soundIcon, soundLabel);
  const coarse = matchMedia("(pointer: coarse)").matches;
  const skipHint = el("div", "pq-skip");
  chrome.append(sound, skipHint);

  const warm = el("div", "pq-warm");
  warm.setAttribute("aria-hidden", "true");
  for (const t of [config.siteName, config.tagline, `0123456789 ${config.subjects.join(" ")}`])
    warm.append(el("span", undefined, t));

  root.append(sheet, chrome, warm);
  document.body.append(root);

  /* ---- Sound ---- */
  const audio = createIntroAudio(() => renderSound());
  const renderSound = () => {
    if (!audio) {
      sound.hidden = true;
      skipHint.textContent = coarse ? "TAP TO SKIP" : "CLICK · ESC TO SKIP";
      return;
    }
    const state = !audio.enabled ? "off" : audio.blocked ? "blocked" : "on";
    sound.dataset.state = state;
    soundLabel.textContent =
      state === "blocked" ? "TAP FOR SOUND" : state === "on" ? "SOUND ON" : "SOUND OFF";
    sound.setAttribute(
      "aria-label",
      state === "blocked" ? "Turn sound on" : `Sound ${state}. Toggle sound`,
    );
    if (state !== "blocked") sound.setAttribute("aria-pressed", String(state === "on"));
    else sound.removeAttribute("aria-pressed");
    skipHint.textContent =
      state === "blocked"
        ? coarse
          ? ""
          : "ESC TO SKIP"
        : coarse
          ? "TAP TO SKIP"
          : "CLICK · ESC TO SKIP";
  };
  renderSound();
  const soundBlocked = () => !!audio && audio.enabled && audio.blocked;
  sound.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!audio) return;
    if (soundBlocked()) audio.unlock();
    else {
      audio.setEnabled(!audio.enabled);
      if (audio.enabled && audio.blocked) audio.unlock();
    }
    renderSound();
  });

  /* ---- Input ---- */
  const onClick = (e: MouseEvent) => {
    if (sound.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    // While sound is blocked, the first click only unlocks it.
    if (soundBlocked()) {
      audio!.unlock();
      return;
    }
    skip();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      if (e.target === sound && e.key === "Enter") return;
      e.preventDefault();
      if (e.key === "Enter" && soundBlocked()) audio!.unlock();
      skip();
      return;
    }
    if (soundBlocked() && e.key !== "Tab") audio!.unlock();
  };
  let mx = 0,
    my = 0,
    px = 0,
    py = 0;
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    mx = (e.clientX / vw) * 2 - 1;
    my = (e.clientY / vh) * 2 - 1;
  };
  root.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointermove", onPointer, { passive: true });

  /* ---- Schedules ---- */
  const years: number[] = [];
  for (let y = config.yearFrom; y <= year; y++) years.push(y);
  const yearTimes = years.map((_, i) =>
    i === 0
      ? T.boardSet
      : T.yearsStart +
        (T.yearsEnd - T.yearsStart) * Math.pow((i - 1) / Math.max(1, years.length - 2), 0.62),
  );
  const subjects = ["OPENING ARCHIVE", ...config.subjects];
  const subjectTimes = subjects.map((_, i) =>
    i === 0
      ? T.boardSet + 0.08
      : T.subjectsStart +
        (T.subjectsEnd - T.subjectsStart) *
          Math.pow((i - 1) / Math.max(1, subjects.length - 2), 0.55),
  );
  let yearIdx = 0,
    subjectIdx = 0;

  // Bubbles fill left → right, each only after the beam has drawn its row.
  const bubbles: Bubble[] = [];
  let gridTop = 0;
  const beamTime = (y: number) =>
    T.scan + T.scanDur * clamp01((y + vh * 0.05) / (vh * 1.1));
  const gridOrigin = { x: 2 * pitch + pitch / 2, y: 2 * pitch + pitch / 2 };
  const prepareBubbles = () => {
    for (const i of dots.on) {
      const col = i % dots.cols,
        row = Math.floor(i / dots.cols);
      const x = gridOrigin.x + col * pitch,
        y = gridOrigin.y + row * pitch;
      const start = Math.max(
        T.fillStart + T.fillDur * (col / dots.cols) + Math.random() * 0.05,
        beamTime(gridTop + y) + 0.06,
      );
      bubbles.push({ x, y, start, angle: Math.random() * Math.PI * 2, done: false });
    }
  };
  let drawnRows = 0;
  const ringColor = "rgba(155,168,196,0.3)";
  const drawRows = (upTo: number) => {
    base.strokeStyle = ringColor;
    base.lineWidth = Math.max(1, pitch * 0.075);
    base.beginPath();
    for (; drawnRows < Math.min(upTo, grows); drawnRows++) {
      const y = drawnRows * pitch + pitch / 2;
      for (let c = 0; c < gcols; c++) {
        const x = c * pitch + pitch / 2;
        base.moveTo(x + radius, y);
        base.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    base.stroke();
  };
  const inkFill = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  /* ---- Loop ---- */
  let t0 = 0,
    last = 0,
    frameId = 0,
    lastCount = 0,
    shownCount = 0,
    shownBar = -1,
    phase = 0,
    exiting = false;
  const events: [number, () => void][] = [
    [0.05, () => root.classList.add("pq-is-boot")],
    [T.yearsEnd + 0.32, () => root.classList.add("pq-is-landed")],
    [
      T.scan,
      () => {
        root.classList.add("pq-is-scan");
        prepareBubbles();
        beam.style.opacity = "1";
        audio?.hum(T.scanDur);
      },
    ],
    [T.fillStart + 0.05, () => audio?.scribble(T.fillDur + 0.1)],
    [T.named, () => root.classList.add("pq-is-named")],
    [T.stamp, slam],
    [T.prepareTear, () => void prepareTear()],
    [T.exit, () => skip()],
  ];

  function slam() {
    stamp.style.opacity = "1";
    stamp.animate(
      [
        { transform: "rotate(-11deg) scale(2.5)", opacity: 0 },
        { transform: "rotate(-11deg) scale(0.93)", opacity: 1, offset: 0.7 },
        { transform: "rotate(-11deg) scale(1)", opacity: 1 },
      ],
      { duration: 250, easing: "cubic-bezier(.55,0,.9,.4)" },
    );
    setTimeout(() => {
      if (exiting) return;
      audio?.thud();
      stage.animate(
        [
          { transform: "translate(0,0)" },
          { transform: "translate(-7px,5px)" },
          { transform: "translate(6px,-4px)" },
          { transform: "translate(-4px,3px)" },
          { transform: "translate(2px,-1px)" },
          { transform: "translate(0,0)" },
        ],
        { duration: 300, easing: "ease-out" },
      );
    }, 170);
  }

  const tick = (now: number) => {
    if (!t0) {
      t0 = last = now;
      gridTop = baseCanvas.getBoundingClientRect().top;
    }
    const t = (now - t0) / 1000,
      dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Background drift + mouse parallax.
    px += (mx - px) * 0.06;
    py += (my - py) * 0.06;
    drifters.forEach((d, i) => {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.r += d.vr * dt;
      if (d.y < -d.h * 1.2) d.y = vh + d.h * 0.2;
      const transform = `translate3d(${(d.x + px * d.depth * 26).toFixed(1)}px,${(d.y + py * d.depth * 18).toFixed(1)}px,0) rotate(${d.r.toFixed(2)}deg)`;
      d.node.style.transform = transform;
      if (tear) tear.papers[i].style.transform = transform;
    });

    if (!exiting) {
      while (phase < events.length && t >= events[phase][0]) events[phase++][1]();

      // Flaps.
      while (yearIdx < years.length && t >= yearTimes[yearIdx]) {
        const gap =
          yearIdx + 1 < years.length ? yearTimes[yearIdx + 1] - yearTimes[yearIdx] : 0.3;
        const changed = flipRow(yearCells, String(years[yearIdx]), Math.min(300, gap * 900), 22);
        if (changed) audio?.clack(0.9 + changed * 0.05);
        yearIdx++;
      }
      while (subjectIdx < subjects.length && t >= subjectTimes[subjectIdx]) {
        const gap =
          subjectIdx + 1 < subjects.length
            ? subjectTimes[subjectIdx + 1] - subjectTimes[subjectIdx]
            : 0.3;
        const changed = flipRow(
          subjectCells,
          subjects[subjectIdx],
          Math.max(70, Math.min(240, gap * 850)),
          gap > 0.14 ? 9 : 3,
        );
        if (changed && (gap > 0.09 || subjectIdx % 2 === 0)) audio?.clack(0.55);
        subjectIdx++;
      }

      // Counter + bar (throttled to ~22 updates/s; bar is a cheap transform).
      const p = clamp01((t - T.countStart) / (T.countEnd - T.countStart));
      const fill = +easeInOut(p).toFixed(4);
      if (fill !== shownBar) {
        shownBar = fill;
        barFill.style.transform = `scaleX(${fill})`;
      }
      const value = Math.round(config.paperCount * easeInOut(p));
      if (value !== shownCount && (now - lastCount > 45 || p === 1)) {
        lastCount = now;
        shownCount = value;
        countEl.textContent = String(value).padStart(4, "0");
      }

      // Beam and OMR.
      if (t > T.scan + T.scanDur && drawnRows < grows) {
        // A slow frame skipped the end of the sweep: finish it.
        beam.style.opacity = "0";
        drawRows(grows);
      } else if (t >= T.scan && t <= T.scan + T.scanDur) {
        const k = clamp01((t - T.scan) / T.scanDur);
        const y = -vh * 0.05 + k * vh * 1.1;
        beam.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
        drawRows(Math.floor((y - gridTop) / pitch));
        if (k >= 1) {
          beam.style.opacity = "0";
          drawRows(grows);
        }
      }
      if (bubbles.length && t >= T.fillStart - 0.05) {
        fx.clearRect(0, 0, gw, gh);
        let live = 0;
        bubbles.forEach((b, i) => {
          if (b.done || t < b.start) {
            if (!b.done) live++;
            return;
          }
          const k = (t - b.start) / POP;
          if (k >= 1) {
            b.done = true;
            base.fillStyle = "#5ee1ff";
            inkFill(base, b.x, b.y, radius * 1.02);
            return;
          }
          live++;
          const s = k < 0.6 ? easeOut(k / 0.6) * 1.28 : 1.28 - 0.26 * ((k - 0.6) / 0.4);
          fx.globalAlpha = 1;
          fx.fillStyle = "#5ee1ff";
          inkFill(fx, b.x, b.y, radius * s);
          // Tiny ink splash.
          fx.globalAlpha = 1 - k;
          fx.fillStyle = i % 3 ? "#8fd8ff" : "#b39dff";
          const a = b.angle;
          for (let j = 0; j < 3; j++) {
            const ang = a + j * 2.1,
              dist = radius * (1.05 + k * 1.5);
            inkFill(fx, b.x + Math.cos(ang) * dist, b.y + Math.sin(ang) * dist, radius * 0.2 * (1 - k * 0.6));
          }
        });
        fx.globalAlpha = 1;
        if (!live) bubbles.length = 0;
      }
    }
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  /* ---- Exit: the paper tears down the middle ---- */
  // The right half is a clone of the paper. It is made and both halves are cut ahead of time,
  // at a still moment, so the tear itself only starts compositor animations.
  type Tear = {
    copy: HTMLElement;
    papers: HTMLElement[];
    fibers: HTMLElement[];
    tearX: number;
  };
  let tear: Tear | null = null;
  function prepareTear(): Tear {
    if (tear) return tear;
    if (drawnRows) drawRows(grows);
    beam.style.opacity = "0";
    const tearX = vw * (0.47 + Math.random() * 0.06);
    const pts: [number, number][] = [];
    const steps = narrow ? 18 : 30;
    for (let i = 0; i <= steps; i++) {
      const jag = (Math.random() - 0.5) * (i % 4 === 0 ? 34 : 14);
      pts.push([tearX + Math.sin(i * 0.7) * 10 + jag, (i / steps) * 100]);
    }
    const edge = (dx: number) =>
      pts.map(([x, y]) => `${(x + dx).toFixed(1)}px ${y.toFixed(2)}%`).join(", ");
    const leftClip = (dx: number) => `polygon(0 0, ${edge(dx)}, 0 100%)`;
    const rightClip = (dx: number) => `polygon(100% 0, ${edge(dx)}, 100% 100%)`;

    const copy = sheet.cloneNode(true) as HTMLElement;
    copy.setAttribute("aria-hidden", "true");
    // Canvas pixels don't clone; copy them.
    const dst = copy.querySelectorAll("canvas");
    sheet.querySelectorAll("canvas").forEach((c, i) => {
      dst[i].getContext("2d")?.drawImage(c, 0, 0);
    });
    // Torn paper fibre: a pale sliver just past each edge, hidden until the halves part.
    const fibers = [leftClip(4.5), rightClip(-3)].map((clip) => {
      const f = el("div", "pq-fiber");
      f.style.clipPath = clip;
      return f;
    });
    // The left half overlaps the identical right half by 1.5px so no seam shows before the tear.
    sheet.style.clipPath = leftClip(1.5);
    copy.style.clipPath = rightClip(0);
    sheet.before(copy);
    tear = {
      copy,
      papers: [...copy.querySelectorAll<HTMLElement>(".pq-paper")],
      fibers,
      tearX,
    };
    return tear;
  }

  function skip() {
    if (exiting) return;
    exiting = true;
    root.classList.add("pq-is-exit");
    audio?.hush();
    audio?.rip(0.62);
    beam.style.opacity = "0";
    const { copy, fibers, tearX } = prepareTear();
    copy.before(...fibers);
    // Let paused site work (the WebGL hero) resume underneath; scroll unlocks when the halves are gone.
    setCover("reveal");

    const origin = `${tearX}px 100%`;
    const fly = (dir: -1 | 1) => [
      { transform: "none", opacity: 1, easing: "cubic-bezier(.3,0,.3,1)" },
      {
        transform: `translate(${dir * 1.2}vw,0) rotate(${dir * 2.4}deg)`,
        opacity: 1,
        offset: 0.2,
        easing: "cubic-bezier(.5,0,.85,.35)",
      },
      {
        transform: `translate(${dir * 78}vw,${16}vh) rotate(${dir * 19}deg)`,
        opacity: 0.85,
      },
    ];
    const opts: KeyframeAnimationOptions = {
      duration: T.tearDur * 1000,
      fill: "forwards",
    };
    const halves: [HTMLElement, -1 | 1][] = [
      [fibers[0], -1],
      [sheet, -1],
      [fibers[1], 1],
      [copy, 1],
    ];
    let last: Animation | undefined;
    for (const [node, dir] of halves) {
      node.style.transformOrigin = origin;
      node.style.willChange = "transform";
      last = node.animate(fly(dir), opts);
    }
    last!.onfinish = () => {
      cancelAnimationFrame(frameId);
      root.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointermove", onPointer);
      audio?.close();
      finish();
    };
  }

  return { skip, done, audio };
}
