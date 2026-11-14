import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The writer location input, in one place.
 *
 * There are four separate writer-creation forms in this app - the agency
 * detail drawer, Users & Agents, the admin agents page, and an agent's own
 * My Writers. Making location required on the API broke three of them at
 * once, which is what this component exists to stop happening again: the
 * field, its geocoding and its wording live here, so a change to any of that
 * reaches every form.
 */

export interface WriterLocationValue {
  location: string;
  lat: string;
  lng: string;
}

export const EMPTY_LOCATION: WriterLocationValue = { location: "", lat: "", lng: "" };

/**
 * Turn a typed place into coordinates.
 *
 * Nominatim, scoped to Ghana, matching the agency location field and the only
 * external host the CSP permits. Failure is deliberately quiet: the text is
 * what was asked for and is saved either way, and the coordinates are what put
 * the writer's terminal on the map. A writer whose village does not geocode
 * should still be registrable.
 */
export async function geocode(query: string): Promise<{ lat: string; lng: string } | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=gh`,
      { headers: { "Accept-Language": "en" } },
    );
    if (!res.ok) return null;
    const results: { lat: string; lon: string }[] = await res.json();
    const hit = results[0];
    if (!hit) return null;
    return { lat: parseFloat(hit.lat).toFixed(6), lng: parseFloat(hit.lon).toFixed(6) };
  } catch {
    return null;
  }
}

/** What a form sends to the API: coordinates omitted rather than sent empty. */
export function locationPayload(v: WriterLocationValue) {
  return {
    location: v.location.trim(),
    ...(v.lat && v.lng ? { lat: v.lat, lng: v.lng } : {}),
  };
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

  const resolve = async (text: string) => {
    if (text.trim().length < 3) {
      onChange({ ...value, location: text, lat: "", lng: "" });
      return;
    }
    setLocating(true);
    const hit = await geocode(text);
    setLocating(false);
    onChange({ ...value, location: text, lat: hit?.lat ?? "", lng: hit?.lng ?? "" });
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        Location{required
          ? <span className="text-destructive"> *</span>
          : <span className="text-muted-foreground"> (optional here)</span>}
      </Label>
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
      {/* Coordinates are shown, never edited: an operator should be able to see
          whether the place was found, and notice when it was not, without
          being asked to supply numbers themselves. */}
      <p className="text-[11px] text-muted-foreground">
        {locating
          ? "Finding location…"
          : value.lat && value.lng
            ? `Mapped to ${value.lat}, ${value.lng}`
            : value.location.trim().length >= 3
              ? "Could not place this on the map — it will be saved as text only."
              : "Used to place this writer's terminal on the map."}
      </p>
    </div>
  );
}
