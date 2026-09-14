import html2canvas from "html2canvas";

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

export async function captureTicketPng(
  elementId: string = TICKET_SLIP_ID,
): Promise<Blob> {
  const node = document.getElementById(elementId);
  if (!node) throw new Error("The ticket is not on screen yet. Open it and try again.");

  const canvas = await html2canvas(node, {
    scale: SCALE,
    // The slip is printed on white paper; render it that way rather than
    // inheriting whatever the page or theme sits on.
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    // Capture the element's own box only - no page margins, no scroll offset.
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: document.documentElement.offsetWidth,
  });

  const trimmed = trimWhitespace(canvas);

  return await new Promise<Blob>((resolve, reject) => {
    trimmed.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not build the image"))),
      "image/png",
    );
  });
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
