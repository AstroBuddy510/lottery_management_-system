/**
 * Where map tiles come from.
 *
 * Pinned in one place, for two reasons that both cost us a working map.
 *
 * The Content-Security-Policy in vercel.json allows tile images from exactly
 * one host. pigeon-maps ships a built-in default provider, so for a while the
 * policy and the map agreed only by coincidence - and when img-src was
 * tightened to 'self' data: blob:, every tile was refused before it reached
 * the network. Changing TILE_HOST means changing img-src in the same commit;
 * that is the whole point of naming it here rather than inlining a URL.
 *
 * And that built-in default pointed at tile.openstreetmap.org, whose usage
 * policy does not cover an application serving tiles to its own users. Those
 * servers eventually returned 403 "App is not following the tile usage
 * policy", which from the outside looks identical to the CSP failure: grey
 * squares, pins in the right places, nothing in the console. Two unrelated
 * faults with one symptom is why this module exists.
 */

/** The only host the CSP permits tile images from. Keep the two in step. */
export const TILE_HOST = "https://api.maptiler.com";

/** MapTiler raster style. Street-level labels, which is what an agency map wants. */
const TILE_STYLE = "streets-v2";

/**
 * Required by MapTiler's terms and by the ODbL. The previous map passed
 * attribution={false}, which is a licence breach on any OSM-derived tiles and
 * is one of the behaviours OSM blocks for.
 */
export const TILE_ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";

/**
 * The API key, from VITE_MAPTILER_KEY. Absent in a checkout with no .env, so
 * every caller has to cope with "" rather than assume a key exists.
 */
export function mapTilerKey(): string {
  const raw = import.meta.env["VITE_MAPTILER_KEY"];
  return typeof raw === "string" ? raw.trim() : "";
}

/** Whether tiles can be requested at all. A false here must not render a grey box. */
export function hasTileKey(): boolean {
  return mapTilerKey().length > 0;
}

/**
 * pigeon-maps provider: (x, y, z, dpr) -> tile URL.
 *
 * Serves @2x on retina so the map is not soft on the laptops this dashboard is
 * actually read on.
 */
export function tileProvider(x: number, y: number, z: number, dpr?: number): string {
  const scale = dpr && dpr > 1 ? "@2x" : "";
  const key = encodeURIComponent(mapTilerKey());
  return `${TILE_HOST}/maps/${TILE_STYLE}/${z}/${x}/${y}${scale}.png?key=${key}`;
}
