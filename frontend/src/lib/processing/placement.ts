/*
 * Where are the photos on a PDF page? Phone "images to PDF" apps often put a landscape
 * photo of an open answer book in the middle of a portrait page with white bands above
 * and below. Guessing that box from pixels fails when the photo itself is very bright, so
 * we read it from the page's drawing instructions instead: the exact rectangle each
 * image is painted into.
 */
export type Matrix = [number, number, number, number, number, number];
export type PdfRect = [number, number, number, number];

/** The pdf.js operator codes this module understands (from pdfjs-dist's OPS). */
export type Ops = {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintImageXObjectRepeat: number;
};

const identity: Matrix = [1, 0, 0, 1, 0, 0];
/** `inner` applied first, then `outer` (PDF's "cm" concatenation). */
function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [p, q, r, s, t, u] = inner;
  return [
    a * p + c * q,
    b * p + d * q,
    a * r + c * s,
    b * r + d * s,
    a * t + c * u + e,
    b * t + d * u + f,
  ];
}
function unitSquare(m: Matrix): PdfRect {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Rectangles (PDF user space) that images are painted into, in drawing order. */
export function imageRects(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: Ops,
): PdfRect[] {
  const rects: PdfRect[] = [];
  const stack: Matrix[] = [];
  let ctm = identity;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i],
      args = argsArray[i] as any;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? identity;
    else if (fn === ops.transform) ctm = compose(ctm, args as Matrix);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0];
      if (Array.isArray(matrix) || ArrayBuffer.isView(matrix))
        ctm = compose(ctm, Array.from(matrix as ArrayLike<number>) as Matrix);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? identity;
    else if (
      fn === ops.paintImageXObject ||
      fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageMaskXObject
    )
      rects.push(unitSquare(ctm));
    else if (fn === ops.paintImageXObjectRepeat) {
      const [, scaleX, scaleY, positions] = args as [
        unknown,
        number,
        number,
        ArrayLike<number>,
      ];
      for (let k = 0; k + 1 < positions.length; k += 2)
        rects.push(
          unitSquare(
            compose(ctm, [
              scaleX,
              0,
              0,
              scaleY,
              positions[k],
              positions[k + 1],
            ]),
          ),
        );
    }
  }
  return rects;
}

export type PixelBox = { x: number; y: number; width: number; height: number };

/**
 * The region of a rendered page covered by its photos, when they leave part of the page
 * empty. `toPixels` maps a PDF rectangle to [x0, y0, x1, y1] in rendered pixels.
 * Returns null when the photos fill the page (nothing to trim) or there are none.
 */
export function photoRegion(
  rects: PdfRect[],
  toPixels: (rect: PdfRect) => [number, number, number, number],
  width: number,
  height: number,
): PixelBox | null {
  const area = width * height;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const rect of rects) {
    const [a, b, c, d] = toPixels(rect);
    const left = Math.max(0, Math.min(a, c)),
      right = Math.min(width, Math.max(a, c)),
      top = Math.max(0, Math.min(b, d)),
      bottom = Math.min(height, Math.max(b, d));
    // Logos, stamps and tiny inline images do not define the sheet.
    if (right - left <= 0 || bottom - top <= 0) continue;
    if ((right - left) * (bottom - top) < area * 0.02) continue;
    x0 = Math.min(x0, left);
    y0 = Math.min(y0, top);
    x1 = Math.max(x1, right);
    y1 = Math.max(y1, bottom);
  }
  if (!Number.isFinite(x0)) return null;
  const box = {
    x: Math.floor(x0),
    y: Math.floor(y0),
    width: Math.ceil(x1) - Math.floor(x0),
    height: Math.ceil(y1) - Math.floor(y0),
  };
  const covered = (box.width * box.height) / area;
  // Nearly full-page photos need no trimming; very small ones are not the sheet.
  return covered < 0.92 && covered > 0.15 ? box : null;
}
