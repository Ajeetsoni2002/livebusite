/*
 * Pure image routines for cleaning phone-photo scans and splitting two-page spreads.
 * They work on plain RGBA / grayscale arrays so the same code runs in the browser
 * (canvas ImageData) and in Node tests/scripts. Nothing here touches the DOM.
 */
export type Img = { width: number; height: number; data: Uint8ClampedArray };
export type Gray = { width: number; height: number; data: Uint8Array };
export type Box = { x: number; y: number; width: number; height: number };
export type Preset = "grayscale" | "bw" | "color";

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export function toGray(img: Img): Gray {
  const out = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; j < out.length; i += 4, j++)
    out[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return { width: img.width, height: img.height, data: out };
}

export function grayToImg(g: Gray): Img {
  const data = new Uint8ClampedArray(g.width * g.height * 4);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    data[j] = data[j + 1] = data[j + 2] = g.data[i];
    data[j + 3] = 255;
  }
  return { width: g.width, height: g.height, data };
}

export function crop<T extends Img | Gray>(src: T, box: Box): T {
  const channels = src.data.length / (src.width * src.height);
  const x = Math.max(0, Math.floor(box.x)),
    y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.min(src.width - x, Math.floor(box.width)));
  const h = Math.max(1, Math.min(src.height - y, Math.floor(box.height)));
  const Ctor = src.data.constructor as new (n: number) => T["data"];
  const data = new Ctor(w * h * channels);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * src.width + x) * channels;
    data.set(src.data.subarray(from, from + w * channels), row * w * channels);
  }
  return { width: w, height: h, data } as T;
}

/** Block reduction; `mode: "max"` keeps paper brightness and ignores thin dark ink. */
export function reduce(
  g: Gray,
  factor: number,
  mode: "mean" | "max" = "mean",
): Gray {
  const f = Math.max(1, Math.round(factor));
  const w = Math.max(1, Math.floor(g.width / f)),
    h = Math.max(1, Math.floor(g.height / f));
  const out = new Uint8Array(w * h);
  for (let by = 0; by < h; by++)
    for (let bx = 0; bx < w; bx++) {
      let acc = 0;
      for (let y = by * f; y < by * f + f; y++) {
        const row = y * g.width;
        for (let x = bx * f; x < bx * f + f; x++) {
          const v = g.data[row + x];
          if (mode === "max") {
            if (v > acc) acc = v;
          } else acc += v;
        }
      }
      out[by * w + bx] = mode === "max" ? acc : Math.round(acc / (f * f));
    }
  return { width: w, height: h, data: out };
}

export function boxBlur(g: Gray, radius: number, passes = 2): Gray {
  let src = Float32Array.from(g.data);
  const { width: w, height: h } = g;
  const tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0,
        n = 0;
      for (let x = -radius; x < w; x++) {
        if (x + radius < w) {
          acc += src[y * w + x + radius];
          n++;
        }
        if (x - radius - 1 >= 0) {
          acc -= src[y * w + x - radius - 1];
          n--;
        }
        if (x >= 0) tmp[y * w + x] = acc / n;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0,
        n = 0;
      for (let y = -radius; y < h; y++) {
        if (y + radius < h) {
          acc += tmp[(y + radius) * w + x];
          n++;
        }
        if (y - radius - 1 >= 0) {
          acc -= tmp[(y - radius - 1) * w + x];
          n--;
        }
        if (y >= 0) src[y * w + x] = acc / n;
      }
    }
    src = Float32Array.from(src);
  }
  return {
    width: w,
    height: h,
    data: Uint8Array.from(src, (v) => Math.round(v)),
  };
}

function percentile(values: ArrayLike<number>, p: number) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const target = p * values.length;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * Trims plain white page padding around a photo that was placed on a PDF page (the photo
 * is a solid non-white block). Clean scans with sparse text are never cropped.
 */
export function contentBox(g: Gray): Box {
  const { width: w, height: h, data } = g;
  const full = { x: 0, y: 0, width: w, height: h };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 400));
  const solid = (n: number, total: number) => n / total > 0.6;
  const row = (y: number, x0 = 0, x1 = w) => {
    let n = 0,
      t = 0;
    for (let x = x0; x < x1; x += step, t++) if (data[y * w + x] < 245) n++;
    return solid(n, t);
  };
  let top = 0,
    bottom = h - 1;
  while (top < h && !row(top)) top++;
  if (top >= h) return full;
  while (bottom > top && !row(bottom)) bottom--;
  const col = (x: number) => {
    let n = 0,
      t = 0;
    for (let y = top; y <= bottom; y += step, t++)
      if (data[y * w + x] < 245) n++;
    return solid(n, t);
  };
  let left = 0,
    right = w - 1;
  while (left < w && !col(left)) left++;
  while (right > left && !col(right)) right--;
  if (left >= right) return full;
  let solidRows = 0,
    rows = 0;
  for (let y = top; y <= bottom; y += step, rows++)
    if (row(y, left, right + 1)) solidRows++;
  const box = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  return solidRows / rows > 0.8 && box.width > w * 0.2 && box.height > h * 0.2
    ? box
    : full;
}

/** Ink/paper split for a normalized sheet; faint photo text sits much higher than scan ink. */
export function inkThreshold(norm: Gray) {
  const f = Math.max(1, Math.round(Math.max(norm.width, norm.height) / 400));
  return Math.min(215, Math.max(120, otsu(reduce(norm, f).data)));
}

function otsu(values: ArrayLike<number>) {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const total = values.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0,
    wB = 0,
    best = 0,
    threshold = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  return threshold;
}

/** Removes a dark table/background around the sheet in a phone photo (edges inward only). */
export function paperBox(g: Gray): Box {
  const f = Math.max(1, Math.round(Math.max(g.width, g.height) / 200));
  const small = reduce(g, f);
  const t = otsu(small.data);
  let dark = 0,
    bright = 0,
    nd = 0,
    nb = 0;
  for (const v of small.data)
    if (v > t) {
      bright += v;
      nb++;
    } else {
      dark += v;
      nd++;
    }
  const full = { x: 0, y: 0, width: g.width, height: g.height };
  // Only a clearly darker surround counts; text and shadows on paper must not.
  if (!nd || !nb || bright / nb - dark / nd < 70 || dark / nd > 110)
    return full;
  const { width: w, height: h, data } = small;
  const brightFrac = (get: (i: number) => number, n: number) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (get(i) > t) c++;
    return c / n;
  };
  const row = (y: number) => brightFrac((x) => data[y * w + x], w);
  const col = (x: number) => brightFrac((y) => data[y * w + x], h);
  let top = 0,
    bottom = h - 1,
    left = 0,
    right = w - 1;
  while (top < h / 3 && row(top) < 0.5) top++;
  while (bottom > (h * 2) / 3 && row(bottom) < 0.5) bottom--;
  while (left < w / 3 && col(left) < 0.5) left++;
  while (right > (w * 2) / 3 && col(right) < 0.5) right--;
  return {
    x: left * f,
    y: top * f,
    width: (right - left + 1) * f,
    height: (bottom - top + 1) * f,
  };
}

/** Low-resolution estimate of the paper's lighting (shadows, gradients). */
export function background(g: Gray): Gray {
  const f = Math.max(2, Math.round(Math.max(g.width, g.height) / 96));
  return boxBlur(reduce(g, f, "max"), 2, 2);
}

function sampleBg(
  bg: Gray,
  scaleX: number,
  scaleY: number,
  x: number,
  y: number,
) {
  const fx = clamp(x * scaleX - 0.5, 0, bg.width - 1),
    fy = clamp(y * scaleY - 0.5, 0, bg.height - 1);
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  const x1 = Math.min(bg.width - 1, x0 + 1),
    y1 = Math.min(bg.height - 1, y0 + 1);
  const ax = fx - x0,
    ay = fy - y0,
    d = bg.data,
    w = bg.width;
  return (
    (d[y0 * w + x0] * (1 - ax) + d[y0 * w + x1] * ax) * (1 - ay) +
    (d[y1 * w + x0] * (1 - ax) + d[y1 * w + x1] * ax) * ay
  );
}

/** Divides out the lighting so paper becomes white and ink keeps its relative darkness. */
export function normalize(g: Gray, bg = background(g)): Gray {
  const out = new Uint8Array(g.data.length);
  const sx = bg.width / g.width,
    sy = bg.height / g.height;
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const b = Math.max(24, sampleBg(bg, sx, sy, x, y));
      const i = y * g.width + x;
      out[i] = Math.min(255, Math.round((g.data[i] / b) * 255));
    }
  return { width: g.width, height: g.height, data: out };
}

/** 0..1: how much the page looks like a phone photo rather than a flatbed scan. */
export function photoScore(img: Img, g = toGray(img)) {
  const f = Math.max(1, Math.round(Math.max(g.width, g.height) / 256));
  const small = reduce(g, f);
  const grid = 8,
    bw = Math.floor(small.width / grid),
    bh = Math.floor(small.height / grid);
  const blocks: number[] = [];
  for (let gy = 0; gy < grid; gy++)
    for (let gx = 0; gx < grid; gx++) {
      const values: number[] = [];
      for (let y = gy * bh; y < (gy + 1) * bh; y++)
        for (let x = gx * bw; x < (gx + 1) * bw; x++)
          values.push(small.data[y * small.width + x]);
      if (values.length) blocks.push(percentile(values, 0.9));
    }
  blocks.sort((a, b) => a - b);
  const p = (q: number) =>
    blocks[Math.min(blocks.length - 1, Math.floor(q * blocks.length))] || 255;
  const uneven = (p(0.95) - p(0.05)) / Math.max(1, p(0.95));
  const paper = p(0.5);
  let cast = 0,
    n = 0;
  const step = Math.max(4, Math.floor(img.data.length / 4 / 40000)) * 4;
  for (let i = 0; i < img.data.length; i += step) {
    const r = img.data[i],
      gg = img.data[i + 1],
      b = img.data[i + 2];
    if (r + gg + b > 450) {
      cast += (Math.abs(r - gg) + Math.abs(gg - b) + Math.abs(r - b)) / 255;
      n++;
    }
  }
  cast = n ? cast / n : 0;
  const score =
    clamp(uneven / 0.15) * 0.5 +
    clamp((245 - paper) / 40) * 0.3 +
    clamp(cast / 0.1) * 0.2;
  return { score, uneven, paper, cast };
}

export type SpreadResult = {
  split: boolean;
  review: boolean;
  confidence: number;
  /** Split position as a fraction of the analysed width. */
  at: number;
  reason: string;
};

/**
 * Finds an empty vertical gutter (optionally with a fold line) near the middle of a wide
 * page. A gutter must be empty from top to bottom, so tables or text crossing the middle
 * of a genuine landscape page never qualify.
 */
export function detectSpread(norm: Gray): SpreadResult {
  const none = (reason: string, confidence = 0): SpreadResult => ({
    split: false,
    review: false,
    confidence,
    at: 0.5,
    reason,
  });
  const aspect = norm.width / norm.height;
  if (aspect < 1.05) return none("portrait page");
  const f = Math.max(1, Math.round(norm.width / 600));
  const s = reduce(norm, f);
  const { width: W, height: H, data } = s;
  const dark = inkThreshold(norm);
  const y0 = Math.floor(H * 0.06),
    y1 = Math.ceil(H * 0.94);
  const ink = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = y0; y < y1; y++) if (data[y * W + x] < dark) c++;
    ink[x] = c / (y1 - y0);
  }
  // A fold line or binding shadow is dark nearly top-to-bottom; text never is.
  const line = Array.from(ink, (v) => v > 0.45);
  const text = Float32Array.from(ink, (v, i) => (line[i] ? 0 : v));
  const r = Math.max(2, Math.round(W * 0.006));
  const smooth = text.map((_, i) => {
    let acc = 0,
      n = 0;
    for (let k = i - r; k <= i + r; k++)
      if (k >= 0 && k < W) {
        acc += text[k];
        n++;
      }
    return acc / n;
  });
  const mean = (a: number, b: number) => {
    let acc = 0;
    for (let i = Math.floor(a * W); i < Math.floor(b * W); i++)
      acc += smooth[i];
    return acc / Math.max(1, Math.floor(b * W) - Math.floor(a * W));
  };
  const left = mean(0.06, 0.4),
    right = mean(0.6, 0.94);
  if (left < 0.01 || right < 0.01) return none("one side is empty");
  const low = Math.min(left, right) * 0.15;
  let bestStart = -1,
    bestLen = 0;
  for (
    let x = Math.floor(W * 0.35), start = -1;
    x <= Math.ceil(W * 0.65);
    x++
  ) {
    const quiet = x < W * 0.65 && (smooth[x] <= low || line[x]);
    if (quiet && start < 0) start = x;
    if (!quiet && start >= 0) {
      if (x - start > bestLen) {
        bestLen = x - start;
        bestStart = start;
      }
      start = -1;
    }
  }
  const lineNearCenter = line.some((v, i) => v && Math.abs(i / W - 0.5) < 0.05);
  const aspectScore = clamp((aspect - 1.05) / 0.3);
  if (bestLen <= 0) {
    if (lineNearCenter && aspect > 1.25)
      return {
        split: false,
        review: true,
        confidence: 0.55,
        at: line.findIndex((v, i) => v && Math.abs(i / W - 0.5) < 0.05) / W,
        reason: "fold line without a clear gutter",
      };
    return none("content crosses the middle");
  }
  // The gutter must be empty in (almost) every row, not just on average.
  // Checked at full resolution: thin table rules vanish when the page is reduced.
  const fy0 = Math.floor((y0 / H) * norm.height),
    fy1 = Math.floor((y1 / H) * norm.height);
  const gx0 = bestStart * f,
    gx1 = Math.min(norm.width, (bestStart + bestLen) * f);
  let rowsWithInk = 0;
  for (let y = fy0; y < fy1; y++) {
    let c = 0,
      n = 0;
    for (let x = gx0; x < gx1; x++) {
      if (line[Math.floor(x / f)]) continue;
      n++;
      if (norm.data[y * norm.width + x] < dark) c++;
    }
    if (n && c > n * 0.3) rowsWithInk++;
  }
  const crossing = rowsWithInk / Math.max(1, fy1 - fy0);
  if (crossing > 0.015) return none("lines cross the middle", 0.2);
  const at = (bestStart + bestLen / 2) / W;
  const valleyScore = clamp(bestLen / W / 0.025);
  const balance = clamp(Math.min(left, right) / Math.max(left, right) / 0.4);
  const centred = clamp(1 - Math.abs(at - 0.5) / 0.15);
  const confidence = clamp(
    0.35 * aspectScore +
      0.3 * valleyScore +
      0.15 * balance +
      0.2 * centred +
      (lineNearCenter ? 0.1 : 0),
  );
  return {
    split: confidence >= 0.7,
    review: confidence >= 0.45 && confidence < 0.7,
    confidence,
    at,
    reason: lineNearCenter ? "gutter with fold line" : "empty gutter",
  };
}

/** Skew angle in degrees (positive = content rotated counter-clockwise). */
export function estimateSkew(norm: Gray, maxDeg = 4, stepDeg = 0.2) {
  const f = Math.max(1, Math.round(norm.width / 700));
  const s = reduce(norm, f);
  const dark = Math.min(inkThreshold(norm), 180);
  const points: number[] = [];
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++)
      if (s.data[y * s.width + x] < dark) points.push(x, y);
  if (points.length < 400) return 0;
  const stride = Math.max(2, Math.floor(points.length / 2 / 40000) * 2);
  const bins = new Float64Array(s.height * 2 + 4);
  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180,
      sin = Math.sin(t),
      cos = Math.cos(t);
    bins.fill(0);
    for (let i = 0; i < points.length; i += stride) {
      const r = Math.round(points[i + 1] * cos + points[i] * sin) + s.height;
      if (r >= 0 && r < bins.length) bins[r]++;
    }
    let sum = 0;
    for (const b of bins) sum += b * b;
    return sum;
  };
  let best = 0,
    bestScore = score(0);
  const flat = bestScore;
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += stepDeg) {
    const v = score(d);
    if (v > bestScore) {
      bestScore = v;
      best = d;
    }
  }
  // Ignore noise-level improvements; a straight page should stay untouched.
  return Math.abs(best) >= 0.3 && bestScore > flat * 1.03
    ? +best.toFixed(2)
    : 0;
}

/** Rotates by `deg` (counter-clockwise) around the centre with bilinear sampling, white fill. */
export function rotate(img: Img, deg: number): Img {
  const t = (deg * Math.PI) / 180,
    sin = Math.sin(t),
    cos = Math.cos(t);
  const { width: w, height: h, data: src } = img;
  const out = new Uint8ClampedArray(src.length);
  const cx = (w - 1) / 2,
    cy = (h - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Inverse mapping: where does this output pixel come from?
      const dx = x - cx,
        dy = y - cy;
      const sx = cos * dx - sin * dy + cx,
        sy = sin * dx + cos * dy + cy;
      const o = (y * w + x) * 4;
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
        continue;
      }
      const ax = sx - x0,
        ay = sy - y0;
      const i00 = (y0 * w + x0) * 4,
        i10 = i00 + 4,
        i01 = i00 + w * 4,
        i11 = i01 + 4;
      for (let c = 0; c < 4; c++)
        out[o + c] =
          (src[i00 + c] * (1 - ax) + src[i10 + c] * ax) * (1 - ay) +
          (src[i01 + c] * (1 - ax) + src[i11 + c] * ax) * ay;
    }
  return { width: w, height: h, data: out };
}

/** Exact quarter turns (user "rotate" control), clockwise. */
export function rotateQuarter(img: Img, turns: number): Img {
  const q = ((turns % 4) + 4) % 4;
  if (!q) return img;
  const { width: w, height: h, data } = img;
  const W = q % 2 ? h : w,
    H = q % 2 ? w : h;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [nx, ny] =
        q === 1
          ? [h - 1 - y, x]
          : q === 2
            ? [w - 1 - x, h - 1 - y]
            : [y, w - 1 - x];
      const s = (y * w + x) * 4,
        d = (ny * W + nx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  return { width: W, height: H, data: out };
}

function levels(g: Gray) {
  // Ink keeps its relative darkness; only the faintest grey near paper is lifted to white.
  const black = Math.min(110, percentile(g.data, 0.004));
  const white = 238;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++)
    lut[v] = Math.round(255 * clamp((v - black) / (white - black)) ** 1.25);
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) out[i] = lut[g.data[i]];
  return { width: g.width, height: g.height, data: out };
}

function sharpen(g: Gray, amount = 0.6): Gray {
  const blur = boxBlur(g, 1, 1);
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++)
    out[i] = clamp(g.data[i] + amount * (g.data[i] - blur.data[i]), 0, 255);
  return { width: g.width, height: g.height, data: out };
}

/**
 * Turns a phone photo into a clean scan. "grayscale" (default) keeps pencil and diagram
 * shading; "bw" uses a soft threshold so thin lines survive; "color" keeps colour with
 * neutral white paper.
 */
export function enhance(img: Img, preset: Preset): Img {
  const g = toGray(img);
  const bg = background(g);
  if (preset === "color") {
    const sx = bg.width / g.width,
      sy = bg.height / g.height;
    const out = new Uint8ClampedArray(img.data.length);
    let rs = 0,
      gs = 0,
      bs = 0,
      n = 0;
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        const gain = 255 / Math.max(24, sampleBg(bg, sx, sy, x, y));
        const o = (y * g.width + x) * 4;
        out[o] = img.data[o] * gain;
        out[o + 1] = img.data[o + 1] * gain;
        out[o + 2] = img.data[o + 2] * gain;
        out[o + 3] = 255;
        if (out[o] + out[o + 1] + out[o + 2] > 600) {
          rs += out[o];
          gs += out[o + 1];
          bs += out[o + 2];
          n++;
        }
      }
    // White balance: paper should be neutral.
    const avg = n ? (rs + gs + bs) / (3 * n) : 255;
    const k = n ? [avg / (rs / n), avg / (gs / n), avg / (bs / n)] : [1, 1, 1];
    for (let o = 0; o < out.length; o += 4)
      for (let c = 0; c < 3; c++) {
        const v = clamp((out[o + c] * k[c] - 20) / 215) ** 1.15;
        out[o + c] = v * 255;
      }
    return { width: img.width, height: img.height, data: out };
  }
  const clean = sharpen(levels(normalize(g, bg)));
  if (preset === "bw") {
    // Soft ramp instead of a hard cut keeps hairlines and anti-aliased edges.
    for (let i = 0; i < clean.data.length; i++)
      clean.data[i] = Math.round(255 * clamp((clean.data[i] - 120) / 70));
  }
  return grayToImg(clean);
}
