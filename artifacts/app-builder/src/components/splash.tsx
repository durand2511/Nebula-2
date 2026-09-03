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
import introSoundUrl from "../assets/nebula-intro.m4a";

const SEEN = "nebula_splash";

// The Nebula intro sound (waterdrop) — plays on the click gesture, so autoplay rules allow it.
function playIntro(): void {
  try {
    const a = new Audio(introSoundUrl);
    a.volume = 0.6;
    void a.play().catch(() => { /* blocked or unsupported — animation still plays */ });
  } catch { /* no audio available */ }
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
    playIntro();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShow(false); return; }
    setLeaving(true);
    window.setTimeout(() => setShow(false), 1900);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
      style={{ transition: "opacity .55s ease 1.35s", opacity: leaving ? 0 : 1 }}
      aria-label={t("Taalkeuze", "Language choice")}
    >
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden="true" />
      <div className="absolute inset-0 bg-white/55" aria-hidden="true" />
      {/* Grows SLOWLY and stays comfortably inside the viewport (≈1.35×) — never clipped by the
          screen edges — then the whole splash gently fades into the app. */}
      <img
        src={logoUrl}
        alt="Nebula"
        className="relative h-56 md:h-80 w-auto select-none"
        style={{
          transition: "transform 1.8s cubic-bezier(.22,.7,.3,1)",
          transform: leaving ? "scale(1.35)" : "scale(1)",
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
