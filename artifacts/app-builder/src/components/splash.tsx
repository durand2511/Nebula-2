/**
 * Startup splash — Netflix-style: the Nebula logo on the familiar nature background, a language
 * choice (🇳🇱/🇬🇧), and on click a short chime while the logo swells up and the splash melts away.
 * Shows once per tab-session; the chosen language persists (the choice can be changed here anytime
 * on the next fresh visit).
 */
import { useEffect, useRef, useState } from "react";
import { bgUrl } from "@/lib/background";
import { useLang, type Lang } from "@/lib/i18n";
import logoUrl from "../assets/nebula-logo-home.png";

const SEEN = "nebula_splash";

// A soft two-note "ta-dum" via WebAudio — no audio file, no network, plays on the click gesture.
function chime(): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    const note = (freq: number, at: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + at);
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + dur);
      o.connect(g).connect(master);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + dur + 0.05);
    };
    note(392, 0, 0.5);      // G4
    note(587.33, 0.12, 0.9); // D5 — the swell
    note(783.99, 0.12, 0.9); // G5 (fifth on top for warmth)
    window.setTimeout(() => { void ctx.close().catch(() => {}); }, 1600);
  } catch { /* no audio available — the animation still plays */ }
}

export function Splash() {
  const { t, setLang } = useLang();
  const [show, setShow] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SEEN) !== "1"; } catch { return true; }
  });
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (show) { try { sessionStorage.setItem(SEEN, "1"); } catch { /* ignore */ } }
  }, [show]);

  if (!show) return null;

  const choose = (l: Lang) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLang(l);
    chime();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShow(false); return; }
    setLeaving(true);
    window.setTimeout(() => setShow(false), 1250);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
      style={{ transition: "opacity .45s ease .75s", opacity: leaving ? 0 : 1 }}
      aria-label={t("Taalkeuze", "Language choice")}
    >
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden="true" />
      <div className="absolute inset-0 bg-white/55" aria-hidden="true" />
      <img
        src={logoUrl}
        alt="Nebula"
        className="relative h-56 md:h-80 w-auto select-none"
        style={{
          transition: "transform 1.15s cubic-bezier(.65,0,.35,1), opacity 1.1s ease .15s",
          transform: leaving ? "scale(14)" : "scale(1)",
          opacity: leaving ? 0 : 1,
        }}
        draggable={false}
      />
      <div
        className="relative mt-10 flex flex-col items-center gap-4"
        style={{ transition: "opacity .3s ease", opacity: leaving ? 0 : 1 }}
      >
        <p className="text-xs uppercase tracking-[0.3em] text-neutral-700/70">Taal · Language</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => choose("nl")}
            className="flex items-center gap-2.5 rounded-full border border-white/70 bg-white/90 backdrop-blur px-6 py-3 text-sm font-semibold text-neutral-900 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
            data-testid="button-lang-nl"
          >
            <span className="text-xl leading-none">🇳🇱</span> Nederlands
          </button>
          <button
            onClick={() => choose("en")}
            className="flex items-center gap-2.5 rounded-full border border-white/70 bg-white/90 backdrop-blur px-6 py-3 text-sm font-semibold text-neutral-900 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
            data-testid="button-lang-en"
          >
            <span className="text-xl leading-none">🇬🇧</span> English
          </button>
        </div>
      </div>
    </div>
  );
}
