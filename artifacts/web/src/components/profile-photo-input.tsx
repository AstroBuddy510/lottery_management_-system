import { useRef } from "react";

interface ProfilePhotoInputProps {
  value: string | null;
  onChange: (base64: string | null) => void;
  name?: string;
  size?: number;
  disabled?: boolean;
}

function resizeToDataUrl(file: File, maxPx = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function CameraIcon({ size }: { size: number }) {
  const s = Math.round(size * 0.36);
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  );
}

export function ProfilePhotoInput({ value, onChange, name, size = 80, disabled = false }: ProfilePhotoInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await resizeToDataUrl(file);
      onChange(base64);
    } catch {
      // ignore
    }
    e.target.value = "";
  };

  const initials = (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="relative rounded-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 group"
        style={{ width: size, height: size }}
        aria-label="Upload profile photo"
      >
        {value ? (
          <img
            src={value}
            alt="Profile"
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground font-semibold border-2 border-dashed border-border"
            style={{ fontSize: size * 0.28 }}
          >
            {name ? initials : <CameraIcon size={size} />}
          </div>
        )}
        {!disabled && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
            <CameraIcon size={size} />
          </div>
        )}
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="text-xs text-primary font-medium hover:underline disabled:opacity-40"
        >
          {value ? "Change photo" : "Upload photo"}
        </button>
        {value && (
          <>
            <span className="text-muted-foreground text-xs">·</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(null)}
              className="text-xs text-destructive hover:underline disabled:opacity-40"
            >
              Remove
            </button>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
