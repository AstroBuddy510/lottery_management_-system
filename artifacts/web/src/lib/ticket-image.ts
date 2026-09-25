import html2canvas from "html2canvas";
import { WIN_GREEN } from "@/components/ticket-receipt";

/**
 * The ticket slip as a PNG.
 *
 * Writers are asked for the slip constantly, and a photo of a phone screen is
 * what they send today - glare, crop, unreadable numbers. This renders the
 * slip element itself, so what the customer receives is exactly what prints.
 *
 * The element captured is the slip, not its container, which is what keeps
 * the surrounding page padding out of the image.
 */

export const TICKET_SLIP_ID = "ticket-receipt-slip";

/** Crisp on a phone screen without producing a needlessly huge file. */
const SCALE = 3;

/** Ring geometry, in CSS pixels; multiplied by SCALE when drawn. */
const RING_STROKE = 1.5;
const RING_PAD_X = 3;
const RING_PAD_Y = 2.5;

export async function captureTicketPng(
  elementId: string = TICKET_SLIP_ID,
): Promise<Blob> {
  const node = document.getElementById(elementId);
  if (!node) throw new Error("The ticket is not on screen yet. Open it and try again.");

  // Where the winning numbers are, horizontally, before anything is drawn.
  // Across is faithful in the capture; down is not, which is the whole reason
  // drawWinnerRings exists.
  const canvas = await html2canvas(node, {
    scale: SCALE,
    // The slip is printed on white paper; render it that way rather than
    // inheriting whatever the page or theme sits on.
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    // No scroll or window overrides on purpose.
    //
    // `scrollY: -window.scrollY` is the idiom for capturing a whole PAGE, and
    // this captures one ELEMENT. The slip sits inside a dialog that scrolls in
    // its own right, so subtracting the window's scroll describes an offset
    // the slip does not have, and everything positioned against a containing
    // block can land somewhere the live page never put it. Passing
    // `windowWidth` without `windowHeight` skews the cloned layout the same
    // way. html2canvas measures the element itself correctly when simply left
    // to do so - verified with both the page and the dialog scrolled.
    //
    // The CSS rings are hidden for the capture and redrawn afterwards, for
    // the reason set out above drawWinnerRings. Only the colour is changed,
    // so the boxes still occupy exactly the space they did and no text moves.
    onclone: (doc: Document) => {
      doc.querySelectorAll<HTMLElement>("[data-win-ring]").forEach((el) => {
        el.style.borderColor = "transparent";
      });
    },
  });

  drawWinnerRings(canvas, node, SCALE);

  const trimmed = trimWhitespace(canvas);

  return await new Promise<Blob>((resolve, reject) => {
    trimmed.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not build the image"))),
      "image/png",
    );
  });
}

/**
 * Ring the winning numbers, on the canvas, after html2canvas has painted it.
 *
 * The ring cannot be left to CSS here. html2canvas rebuilds the page in a
 * frame of its own, and inside a <pre> it paints the TEXT of an inline-block
 * about twelve pixels lower than it places that element's box - measured on a
 * live slip, 36 pixels at a scale of 3. So the border comes out sitting above
 * its own digits. Every CSS route was tried against the real renderer: with
 * and without negative margins, display inline, and three vertical-align
 * values. All four land the ring in the same wrong place, because none of
 * them change where html2canvas decides the glyphs go.
 *
 * Positions taken from the DOM are wrong for the same reason. So the rings
 * are fitted to the glyphs as ACTUALLY PAINTED: the horizontal window comes
 * from the DOM, which the capture does honour, and within that window the
 * winning digits are found by their colour - they are the only green text on
 * the slip - and a ring is drawn around what is really there. Whatever
 * html2canvas does with the baseline, the ring follows it.
 *
 * Nothing is drawn for a number that cannot be found. A missing ring is a
 * blemish; a ring around the wrong number on a betting slip is not.
 */
function drawWinnerRings(canvas: HTMLCanvasElement, node: HTMLElement, scale: number): void {
  const marks = Array.from(node.querySelectorAll<HTMLElement>("[data-win-ring]"));
  if (marks.length === 0) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // html2canvas leaves its own transform on the context - a scale plus a
  // sizeable translate. Anything drawn without clearing it lands off-canvas
  // entirely, silently.
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // A tainted canvas cannot be read, so the glyphs cannot be found.
    return;
  }

  const { width, height } = canvas;
  // The winning digits are the only green ink on the slip. The search band
  // keeps this well clear of the company logo, which has green in it.
  const isWinnerInk = (i: number) =>
    data[i + 1]! > 60 && data[i + 1]! - data[i]! > 25 && data[i + 1]! - data[i + 2]! > 15;

  const base = node.getBoundingClientRect();
  ctx.strokeStyle = WIN_GREEN;
  ctx.lineWidth = Math.max(RING_STROKE * scale, 2);

  for (const el of marks) {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor((r.left - base.left) * scale) - 4);
    const x1 = Math.min(width, Math.ceil((r.right - base.left) * scale) + 4);
    const yHint = (r.top - base.top) * scale;
    const hHint = Math.max(r.height * scale, 1);
    const yA = Math.max(0, Math.round(yHint - hHint * 2));
    const yB = Math.min(height, Math.round(yHint + hHint * 3));

    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = yA; y < yB; y++) {
      for (let x = x0; x < x1; x++) {
        if (isWinnerInk((y * width + x) * 4)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) continue;

    ctx.beginPath();
    ctx.ellipse(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (maxX - minX) / 2 + RING_PAD_X * scale,
      (maxY - minY) / 2 + RING_PAD_Y * scale,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
}

/**
 * Crop away uniform white edges.
 *
 * The slip carries its own print margin, and html2canvas can add a pixel or
 * two of its own, which on a phone reads as a lopsided border. Scanning the
 * edges costs a few milliseconds and makes the image sit flush.
 */
function trimWhitespace(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const { width, height } = canvas;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    // A tainted canvas cannot be read. Better a slightly padded image than none.
    return canvas;
  }

  // Anything this close to white counts as background; anti-aliased edges of
  // black text are far darker, so nothing legible is ever trimmed.
  const isBackground = (i: number) =>
    data[i] > 247 && data[i + 1] > 247 && data[i + 2] > 247;

  let top = 0, bottom = height - 1, left = 0, right = width - 1;

  const rowBlank = (y: number) => {
    for (let x = 0; x < width; x++) if (!isBackground((y * width + x) * 4)) return false;
    return true;
  };
  const colBlank = (x: number) => {
    for (let y = top; y <= bottom; y++) if (!isBackground((y * width + x) * 4)) return false;
    return true;
  };

  while (top < bottom && rowBlank(top)) top++;
  while (bottom > top && rowBlank(bottom)) bottom--;
  while (left < right && colBlank(left)) left++;
  while (right > left && colBlank(right)) right--;

  // An all-white capture means something went wrong; return it untouched
  // rather than producing a 1x1 pixel.
  if (right - left < 8 || bottom - top < 8) return canvas;

  // Leave a hair of margin so the content does not touch the edge.
  const pad = Math.round(SCALE * 4);
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  const w = Math.min(width - x, right - left + 1 + pad * 2);
  const h = Math.min(height - y, bottom - top + 1 + pad * 2);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  if (!outCtx) return canvas;
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, w, h);
  outCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/** Save the blob to the device. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ShareOutcome = "shared" | "cancelled" | "unsupported" | "failed";

/**
 * Hand the image to the system share sheet.
 *
 * Only some browsers can share files - desktop Firefox and most desktop
 * browsers cannot - so this reports what happened instead of pretending, and
 * the caller tells the user plainly. The file is already downloaded either
 * way, so nothing is lost when sharing is unavailable.
 */
export async function shareImage(
  blob: Blob,
  filename: string,
  text: string,
): Promise<ShareOutcome> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (!nav.share || !nav.canShare) return "unsupported";

  const file = new File([blob], filename, { type: "image/png" });
  if (!nav.canShare({ files: [file] })) return "unsupported";

  try {
    await nav.share({ files: [file], text });
    return "shared";
  } catch (err) {
    // The user closing the sheet is not a failure worth shouting about.
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return "failed";
  }
}
