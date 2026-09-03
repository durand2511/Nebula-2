import { useState } from "react";
import logoUrl from "../assets/nebula-logo-home.png";
import { useLang } from "@/lib/i18n";

export function Home() {
  const { t, lang } = useLang();
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  // Subtle callback line under the tagline: leave a phone number → POST /api/contact e-mails the
  // owner (existing endpoint), who calls back for a briefing/chat.
  const submit = async () => {
    if (state === "busy" || phone.replace(/\D/g, "").length < 6) { setState("error"); return; }
    setState("busy");
    try {
      // The owner's notification e-mail says which language the visitor used — an English signup
      // means: call back in English.
      const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, note: lang === "en" ? "Briefing/gesprek met de eigenaar (via homepagina, ENGELSE versie — bel in het Engels)" : "Briefing/gesprek met de eigenaar (via homepagina, Nederlandse versie)" }) });
      setState(r.ok ? "done" : "error");
      if (r.ok) setPhone("");
    } catch { setState("error"); }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 w-full py-16 gap-10">
      <img src={logoUrl} alt="Nebula" className="h-64 md:h-96 w-auto" />
      <p className="text-sm md:text-base uppercase tracking-[0.25em] text-muted-foreground text-center">
        {t("Web design bureau", "Web design studio")}
      </p>

      <div className="flex flex-col items-center gap-2 -mt-4">
        {state === "done" ? (
          <p className="text-xs text-emerald-700/90" data-testid="text-callback-done">
            {t("Dankjewel — je wordt snel gebeld voor een gesprek.", "Thank you — you'll get a call soon.")}
          </p>
        ) : (
          <>
            <p className="text-xs text-foreground/45">
              {t("Liever eerst een gesprek? Laat je nummer achter en de eigenaar belt je.", "Prefer a chat first? Leave your number and the owner will call you.")}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); if (state === "error") setState("idle"); }}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                placeholder={t("06 12345678", "+31 6 12345678")}
                className="h-8 w-44 rounded-full border border-border/70 bg-card/70 backdrop-blur px-3.5 text-xs text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-foreground/30"
                data-testid="input-callback-phone"
              />
              <button
                onClick={() => void submit()}
                disabled={state === "busy"}
                className="h-8 rounded-full bg-foreground/85 px-3.5 text-xs font-medium text-background hover:bg-foreground transition-colors disabled:opacity-60"
                data-testid="button-callback"
              >
                {state === "busy" ? "…" : t("Bel mij", "Call me")}
              </button>
            </div>
            {state === "error" && <p className="text-[11px] text-destructive/80">{t("Vul een geldig telefoonnummer in.", "Please enter a valid phone number.")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
