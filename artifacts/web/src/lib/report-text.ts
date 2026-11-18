/**
 * Text for paper.
 *
 * The PDF fonts (jsPDF's built-in Helvetica) cover the Windows-1252
 * characters only. The cedi sign (₵), the true minus (−) and a few others
 * fall outside it and came out as stray symbols that also threw the column
 * widths off. Everything a report prints goes through here first - the PDF
 * and the printed page alike, so the two always read the same:
 *
 *   GH₵ 1,234.50    -> GHS 1,234.50
 *   −GH₵ 1,234.50   -> (GHS 1,234.50)   negatives in brackets, as accounts read
 *   −12             -> -12
 */
const REPLACE: Array<[RegExp, string]> = [
  [/[−-]\s?GH₵\s?([\d,]+(?:\.\d+)?)/g, "(GHS $1)"],
  [/GH₵\s?/g, "GHS "],
  [/₵/g, "GHS "],
  [/−/g, "-"],
  [/[‐‑‒]/g, "-"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, "..."],
  [/›/g, ">"],
  [/‹/g, "<"],
  [/[   ]/g, " "],
  [/✓/g, "Yes"],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ""],
];

// Characters Windows-1252 has beyond Latin-1 - kept as they are.
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function reportText(input: unknown): string {
  let s = input === null || input === undefined ? "" : String(input);
  for (const [re, to] of REPLACE) s = s.replace(re, to);
  // Anything else the fonts cannot draw is dropped rather than printed as noise.
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c < 256 || CP1252_EXTRA.has(ch) ? ch : "";
  }
  return out.replace(/ {2,}/g, " ").trimEnd();
}
