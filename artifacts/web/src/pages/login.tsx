import { useState } from "react";
import { useAuth } from "@/lib/auth";

type Role = "director" | "administrator" | "cashier" | "gross_entry" | "wins_entry" | "agent";

const ROLES: { value: Role; label: string; abbr: string }[] = [
  { value: "director", label: "Director", abbr: "DIR" },
  { value: "administrator", label: "Administrator", abbr: "ADM" },
  { value: "cashier", label: "Cashier", abbr: "CSH" },
  { value: "gross_entry", label: "Gross Entry", abbr: "GRS" },
  { value: "wins_entry", label: "Wins Entry", abbr: "WIN" },
  { value: "agent", label: "Agent", abbr: "AGT" },
];

const PAD_KEYS = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "",  "0", "⌫",
];

type Step = "phone" | "role" | "pin";

export function Login() {
  const { login, isLoading } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handlePhoneNext = () => {
    if (!phone.trim()) return;
    setError("");
    setStep("role");
  };

  const handleRoleSelect = (r: Role) => {
    setRole(r);
    setError("");
    setStep("pin");
  };

  const handlePadPress = async (key: string) => {
    if (key === "") return;
    if (key === "⌫") {
      setPin(p => p.slice(0, -1));
      setError("");
      return;
    }
    const next = (pin + key).slice(0, 4);
    setPin(next);
    setError("");
    if (next.length === 4) {
      try {
        await login({ phone, role: role as Role, pin: next });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        setPin("");
        setError(
          msg.includes("401") || msg.toLowerCase().includes("invalid")
            ? "Incorrect PIN, phone, or role."
            : "Login failed. Please try again.",
        );
      }
    }
  };

  const goBack = () => {
    setError("");
    setPin("");
    if (step === "pin") setStep("role");
    else if (step === "role") setStep("phone");
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(160deg, #0b1120 0%, #0d1f3c 50%, #0f2a4a 100%)",
      }}
    >
      {/* Background texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "url(/login-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      {/* Decorative glow orbs */}
      <div
        className="absolute top-[-80px] left-[-80px] w-72 h-72 rounded-full opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }}
      />
      <div
        className="absolute top-24 right-[-60px] w-48 h-48 rounded-full opacity-15 pointer-events-none"
        style={{ background: "radial-gradient(circle, #60a5fa 0%, transparent 70%)" }}
      />

      {/* Logo area */}
      <div className="relative z-10 flex flex-col items-center pt-14 pb-8 px-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
          style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)" }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="white" strokeWidth="2.5" />
            <circle cx="18" cy="18" r="7" fill="white" fillOpacity="0.9" />
            <circle cx="18" cy="8" r="3" fill="white" />
            <circle cx="28" cy="23" r="3" fill="white" />
            <circle cx="8" cy="23" r="3" fill="white" />
          </svg>
        </div>
        <div className="text-3xl font-black text-white tracking-tight leading-none">
          VS2000
        </div>
        <div className="text-blue-300 text-xs mt-1.5 tracking-widest uppercase font-semibold">
          Smart Office Platform
        </div>
      </div>

      {/* Step indicator */}
      <div className="relative z-10 flex items-center justify-center gap-2 mb-6">
        {(["phone", "role", "pin"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                step === s
                  ? "bg-blue-400 w-6"
                  : i < (["phone","role","pin"].indexOf(step))
                    ? "bg-blue-500"
                    : "bg-white/20"
              }`}
            />
          </div>
        ))}
      </div>

      {/* Card */}
      <div className="relative z-10 flex-1 flex flex-col mx-0">
        <div
          className="flex-1 flex flex-col px-6 pt-8 pb-4"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "28px 28px 0 0",
          }}
        >

          {/* ── STEP 1: Phone ── */}
          {step === "phone" && (
            <div className="flex flex-col flex-1">
              <div className="mb-8">
                <h2 className="text-white text-2xl font-bold leading-tight">Welcome back</h2>
                <p className="text-blue-200/70 text-sm mt-1">Enter your registered phone number</p>
              </div>
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-blue-200/80 tracking-wider uppercase">
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-300/60 text-sm font-mono">
                    +233
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    autoFocus
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    onKeyDown={e => e.key === "Enter" && phone.trim() && handlePhoneNext()}
                    placeholder="0244 000 001"
                    className="w-full h-14 pl-16 pr-4 rounded-2xl text-white text-base font-mono bg-white/10 border border-white/15 placeholder:text-white/25 focus:outline-none focus:border-blue-400/60 focus:bg-white/15 transition-all"
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 bg-red-500/15 border border-red-400/25 rounded-xl px-4 py-3">
                    <span className="text-red-300 text-xs font-medium">{error}</span>
                  </div>
                )}
              </div>
              <div className="flex-1" />
              <button
                onClick={handlePhoneNext}
                disabled={!phone.trim()}
                className="w-full h-14 rounded-2xl text-white font-bold text-base tracking-wide transition-all duration-200 mt-6 disabled:opacity-30"
                style={{
                  background: phone.trim()
                    ? "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)"
                    : "rgba(255,255,255,0.1)",
                  boxShadow: phone.trim() ? "0 8px 30px rgba(59,130,246,0.4)" : "none",
                }}
              >
                Continue
              </button>
            </div>
          )}

          {/* ── STEP 2: Role ── */}
          {step === "role" && (
            <div className="flex flex-col flex-1">
              <button
                onClick={goBack}
                className="flex items-center gap-1.5 text-blue-300/70 text-sm mb-6 -ml-1 w-fit"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
              <div className="mb-8">
                <h2 className="text-white text-2xl font-bold">Select your role</h2>
                <p className="text-blue-200/70 text-sm mt-1">
                  Signed in as <span className="text-white font-mono">{phone}</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {ROLES.map(r => (
                  <button
                    key={r.value}
                    onClick={() => handleRoleSelect(r.value)}
                    className="flex flex-col items-start p-4 rounded-2xl border transition-all duration-150 active:scale-95"
                    style={{
                      background: role === r.value
                        ? "linear-gradient(135deg, rgba(29,78,216,0.6) 0%, rgba(59,130,246,0.4) 100%)"
                        : "rgba(255,255,255,0.06)",
                      borderColor: role === r.value ? "rgba(96,165,250,0.6)" : "rgba(255,255,255,0.1)",
                    }}
                  >
                    <span
                      className="text-[10px] font-black tracking-widest mb-1.5 font-mono"
                      style={{ color: role === r.value ? "#93c5fd" : "rgba(147,197,253,0.5)" }}
                    >
                      {r.abbr}
                    </span>
                    <span className="text-white text-sm font-semibold leading-tight">{r.label}</span>
                  </button>
                ))}
              </div>
              {error && (
                <div className="flex items-center gap-2 bg-red-500/15 border border-red-400/25 rounded-xl px-4 py-3 mt-4">
                  <span className="text-red-300 text-xs font-medium">{error}</span>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: PIN ── */}
          {step === "pin" && (
            <div className="flex flex-col flex-1">
              <button
                onClick={goBack}
                className="flex items-center gap-1.5 text-blue-300/70 text-sm mb-6 -ml-1 w-fit"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
              <div className="mb-6 text-center">
                <h2 className="text-white text-2xl font-bold">Enter PIN</h2>
                <p className="text-blue-200/70 text-sm mt-1">
                  {ROLES.find(r => r.value === role)?.label} · <span className="font-mono">{phone}</span>
                </p>
              </div>

              {/* PIN dots */}
              <div className="flex items-center justify-center gap-5 mb-8">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full transition-all duration-200"
                    style={{
                      background: i < pin.length
                        ? "linear-gradient(135deg, #3b82f6, #60a5fa)"
                        : "rgba(255,255,255,0.2)",
                      boxShadow: i < pin.length ? "0 0 12px rgba(96,165,250,0.7)" : "none",
                      transform: i < pin.length ? "scale(1.15)" : "scale(1)",
                    }}
                  />
                ))}
              </div>

              {error && (
                <div className="flex items-center justify-center gap-2 bg-red-500/15 border border-red-400/25 rounded-xl px-4 py-3 mb-4">
                  <span className="text-red-300 text-xs font-medium text-center">{error}</span>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center justify-center gap-2 mb-4">
                  <div className="w-5 h-5 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
                  <span className="text-blue-200/70 text-sm">Signing in…</span>
                </div>
              )}

              {/* PIN keypad */}
              <div className="grid grid-cols-3 gap-3 mt-auto">
                {PAD_KEYS.map((key, i) => {
                  const isEmpty = key === "";
                  const isBackspace = key === "⌫";
                  return (
                    <button
                      key={i}
                      onClick={() => !isEmpty && handlePadPress(key)}
                      disabled={isLoading || isEmpty}
                      className={`relative flex items-center justify-center rounded-2xl transition-all duration-100 active:scale-90 select-none ${
                        isEmpty ? "opacity-0 pointer-events-none" : ""
                      }`}
                      style={{
                        height: "72px",
                        background: isEmpty
                          ? "transparent"
                          : isBackspace
                            ? "rgba(239,68,68,0.15)"
                            : "rgba(255,255,255,0.07)",
                        border: isEmpty
                          ? "none"
                          : isBackspace
                            ? "1px solid rgba(239,68,68,0.2)"
                            : "1px solid rgba(255,255,255,0.1)",
                        boxShadow: !isEmpty && !isBackspace ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
                      }}
                    >
                      {isBackspace ? (
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                          <path d="M8 4H19C19.55 4 20 4.45 20 5V17C20 17.55 19.55 18 19 18H8L2 11L8 4Z"
                            stroke="rgba(252,165,165,0.9)" strokeWidth="1.8" strokeLinejoin="round" />
                          <path d="M14 8.5L10 13.5M10 8.5L14 13.5"
                            stroke="rgba(252,165,165,0.9)" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <span className="text-white text-2xl font-semibold tabular-nums">{key}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
