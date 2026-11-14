import React, { useMemo, useState } from "react";
import { Map as PigeonMapBase, Overlay, type MapProps } from "pigeon-maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { tileProvider, hasTileKey, TILE_ATTRIBUTION } from "@/lib/map-tiles";
import { MapPin, Search, Crosshair } from "lucide-react";

/**
 * Where a writer sells from, captured three ways because one is not enough.
 *
 * Geocoding alone was the original design and it quietly produced two kinds of
 * bad data, both observed against the live Nominatim endpoint:
 *
 *   "Adenta Market, Accra"  ->  []            a real market, no result
 *   "Manet Junction"        ->  Koko Junction, Teshie, about 7km away
 *
 * The first leaves a writer with a location name and no coordinates, so they
 * never appear on the terminal map - the bug this replaces. The second is
 * worse: a confident pin in the wrong place, which nobody can see is wrong.
 * Nominatim also rate-limits to roughly one request a second, so registering
 * several writers in a row drops the later lookups silently.
 *
 * So: search is a suggestion, not an answer. Whatever it finds is shown back
 * by name so a wrong match is visible before saving, the pin can be dragged or
 * clicked to the real spot, and the numbers can be typed directly. Accra is
 * the starting view when nothing is known yet.
 */

type PigeonMapProps = MapProps & {
  attribution?: React.ReactNode | false;
  provider?: (x: number, y: number, z: number, dpr?: number) => string;
  children?: React.ReactNode;
};
function PigeonMap(props: PigeonMapProps) {
  return React.createElement(PigeonMapBase as any, props);
}

/** Where the picker opens when the writer has no coordinates yet. */
const ACCRA: [number, number] = [5.6037, -0.187];

export interface WriterLocationValue {
  location: string;
  lat: string;
  lng: string;
}

export const EMPTY_LOCATION: WriterLocationValue = { location: "", lat: "", lng: "" };

export interface GeocodeHit {
  lat: string;
  lng: string;
  displayName: string;
}

/**
 * Ask Nominatim where a place is. Returns the match AND the name it matched,
 * because the name is the only way an operator can tell "Manet Junction" was
 * answered with "Koko Junction".
 */
export async function geocode(query: string): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "gh");
    const res = await fetch(url.toString(), { headers: { "Accept-Language": "en" } });
    if (!res.ok) return null;
    const results: { lat: string; lon: string; display_name: string }[] = await res.json();
    const hit = results[0];
    if (!hit) return null;
    return {
      lat: parseFloat(hit.lat).toFixed(6),
      lng: parseFloat(hit.lon).toFixed(6),
      displayName: hit.display_name,
    };
  } catch {
    return null;
  }
}

/** Coordinates a form may send. Omitted rather than sent empty. */
export function locationPayload(v: WriterLocationValue) {
  return {
    location: v.location.trim(),
    ...(v.lat && v.lng ? { lat: v.lat, lng: v.lng } : {}),
  };
}

/** Inside Ghana's bounding box, roughly. Catches a swapped or mistyped pair. */
export function coordsLookSane(lat: string, lng: string): boolean {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return la >= 4.5 && la <= 11.2 && ln >= -3.3 && ln <= 1.3;
}

function PinPicker({
  open, onOpenChange, value, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: WriterLocationValue;
  onPick: (lat: string, lng: string) => void;
}) {
  const start = useMemo<[number, number]>(
    () => (value.lat && value.lng ? [parseFloat(value.lat), parseFloat(value.lng)] : ACCRA),
    [value.lat, value.lng, open],
  );
  const [center, setCenter] = useState<[number, number]>(start);
  const [zoom, setZoom] = useState(value.lat && value.lng ? 16 : 12);
  const [pin, setPin] = useState<[number, number] | null>(
    value.lat && value.lng ? [parseFloat(value.lat), parseFloat(value.lng)] : null,
  );
  const [search, setSearch] = useState(value.location);
  const [searching, setSearching] = useState(false);
  const [matched, setMatched] = useState<string | null>(null);
  /*
   * The typed boxes hold raw text, not the pin reformatted.
   *
   * Binding them straight to pin[n].toFixed(6) makes them impossible to type
   * in: the first keystroke "5" becomes "5.000000", the next lands after the
   * zeros, and you get 5.0000005. So text is what the operator typed, and the
   * pin follows it only when it parses to a number.
   */
  const [latText, setLatText] = useState(value.lat);
  const [lngText, setLngText] = useState(value.lng);

  /** Move the pin and the boxes together, for map clicks and search hits. */
  const place = (lat: number, lng: number) => {
    setPin([lat, lng]);
    setLatText(lat.toFixed(6));
    setLngText(lng.toFixed(6));
  };

  // Re-seed each time the dialog opens, so it reflects the current value.
  React.useEffect(() => {
    if (!open) return;
    setCenter(start);
    setZoom(value.lat && value.lng ? 16 : 12);
    setPin(value.lat && value.lng ? [parseFloat(value.lat), parseFloat(value.lng)] : null);
    setLatText(value.lat);
    setLngText(value.lng);
    setSearch(value.location);
    setMatched(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = async () => {
    setSearching(true);
    const hit = await geocode(search);
    setSearching(false);
    if (!hit) { setMatched("__none__"); return; }
    setMatched(hit.displayName);
    place(parseFloat(hit.lat), parseFloat(hit.lng));
    setCenter([parseFloat(hit.lat), parseFloat(hit.lng)]);
    setZoom(16);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crosshair className="w-4 h-4" /> Set the writer's pin
          </DialogTitle>
          <DialogDescription>
            Click the map to drop the pin where this writer actually sells. Search is only
            a shortcut — check what it found before you accept it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
            placeholder="Search a place, e.g. Spintex"
            className="h-9 text-sm"
          />
          <Button type="button" variant="outline" className="h-9" onClick={runSearch} disabled={searching}>
            <Search className="w-4 h-4 mr-1" />
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>

        {/* The matched name, verbatim. This is what makes a wrong match visible. */}
        {matched && (
          <p className={`text-[11px] ${matched === "__none__" ? "text-amber-700" : "text-muted-foreground"}`}>
            {matched === "__none__"
              ? "Nothing found for that search. Click the map to place the pin yourself."
              : <>Search found: <strong>{matched}</strong> — if that is not the right place, click the map instead.</>}
          </p>
        )}

        <div className="rounded-xl overflow-hidden border" style={{ height: 380 }}>
          {hasTileKey() ? (
            <PigeonMap
              center={center}
              zoom={zoom}
              provider={tileProvider}
              attribution={<span className="text-[10px] text-slate-500">{TILE_ATTRIBUTION}</span>}
              onBoundsChanged={({ center: c, zoom: z }) => { setCenter(c as [number, number]); setZoom(z); }}
              onClick={({ latLng }: { latLng: [number, number] }) => place(latLng[0], latLng[1])}
            >
              {pin && (
                <Overlay anchor={pin}>
                  <div style={{ transform: "translate(-50%, -100%)" }}>
                    <MapPin className="w-7 h-7 text-red-600 drop-shadow" fill="#ef4444" />
                  </div>
                </Overlay>
              )}
            </PigeonMap>
          ) : (
            <div className="h-full flex items-center justify-center text-center px-6 bg-muted/40">
              <p className="text-xs text-muted-foreground max-w-sm">
                The map needs VITE_MAPTILER_KEY to draw. You can still type coordinates
                directly in the two boxes below.
              </p>
            </div>
          )}
        </div>

        {/* Typed entry, always available. Someone reading a GPS off a phone
            should not have to hunt for a spot on a map they cannot see well. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]" htmlFor="pin-lat">Latitude</Label>
            <Input
              id="pin-lat"
              value={latText}
              onChange={e => {
                const text = e.target.value;
                setLatText(text);
                const la = Number(text), ln = Number(lngText);
                if (text.trim() !== "" && Number.isFinite(la) && Number.isFinite(ln)) setPin([la, ln]);
              }}
              placeholder="5.603700"
              className="h-9 text-sm font-mono"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]" htmlFor="pin-lng">Longitude</Label>
            <Input
              id="pin-lng"
              value={lngText}
              onChange={e => {
                const text = e.target.value;
                setLngText(text);
                const la = Number(latText), ln = Number(text);
                if (text.trim() !== "" && Number.isFinite(la) && Number.isFinite(ln)) setPin([la, ln]);
              }}
              placeholder="-0.187000"
              className="h-9 text-sm font-mono"
              inputMode="decimal"
            />
          </div>
        </div>
        {pin && !coordsLookSane(pin[0].toFixed(6), pin[1].toFixed(6)) && (
          <p className="text-[11px] text-amber-700">
            That point is outside Ghana. Check the two numbers have not been swapped.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={!pin}
            onClick={() => { if (pin) { onPick(pin[0].toFixed(6), pin[1].toFixed(6)); onOpenChange(false); } }}
          >
            Use this pin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WriterLocationField({
  value,
  onChange,
  required = true,
  id = "writer-location",
}: {
  value: WriterLocationValue;
  onChange: (next: WriterLocationValue) => void;
  /** False on edit forms, where a writer who predates the field can be saved as-is. */
  required?: boolean;
  id?: string;
}) {
  const [locating, setLocating] = useState(false);
  const [matched, setMatched] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const resolve = async (text: string) => {
    if (text.trim().length < 3) { setMatched(null); return; }
    // Never overwrite coordinates somebody set by hand or by pin.
    if (value.lat && value.lng) return;
    setLocating(true);
    const hit = await geocode(text);
    setLocating(false);
    setMatched(hit ? hit.displayName : "__none__");
    if (hit) onChange({ ...value, location: text, lat: hit.lat, lng: hit.lng });
  };

  const hasCoords = !!(value.lat && value.lng);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        Location{required
          ? <span className="text-destructive"> *</span>
          : <span className="text-muted-foreground"> (optional here)</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value.location}
          onChange={e => onChange({ ...value, location: e.target.value })}
          onBlur={e => resolve(e.target.value)}
          required={required}
          minLength={required ? 3 : undefined}
          maxLength={200}
          className="h-9 text-sm"
          placeholder="e.g. Adenta Market, Accra"
        />
        <Button
          type="button"
          variant={hasCoords ? "outline" : "default"}
          className="h-9 shrink-0"
          onClick={() => setPickerOpen(true)}
        >
          <MapPin className="w-4 h-4 mr-1" />
          {hasCoords ? "Move pin" : "Set pin"}
        </Button>
      </div>

      {/* State of the coordinates, said plainly. A name without a pin is the
          condition that used to pass silently and leave the writer off the map. */}
      {locating ? (
        <p className="text-[11px] text-muted-foreground">Looking that up…</p>
      ) : hasCoords ? (
        <p className="text-[11px] text-emerald-700">
          Pinned at {value.lat}, {value.lng}
          {matched && matched !== "__none__" && <span className="text-muted-foreground"> · search matched {matched}</span>}
          {!coordsLookSane(value.lat, value.lng) && (
            <span className="text-amber-700"> · that point is outside Ghana, check it</span>
          )}
        </p>
      ) : value.location.trim().length >= 3 ? (
        <p className="text-[11px] text-amber-700">
          {matched === "__none__"
            ? "Search found nothing for this place — use Set pin, or this writer will not appear on the terminal map."
            : "No pin yet — use Set pin, or this writer will not appear on the terminal map."}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          The name plus a pin. The pin is what puts this writer's terminal on the map.
        </p>
      )}

      <PinPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={value}
        onPick={(lat, lng) => onChange({ ...value, lat, lng })}
      />
    </div>
  );
}
