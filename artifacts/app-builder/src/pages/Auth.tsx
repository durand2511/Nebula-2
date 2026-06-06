import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

type AuthView = "login" | "register" | "forgot";

const Auth = () => {
  const { signIn, signUp } = useAuth();
  const [view, setView] = useState<AuthView>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);

    if (view === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Reset link verstuurd! Check je e-mail.");
      }
      setLoading(false);
      return;
    }

    if (!password.trim()) { setLoading(false); return; }

    if (view === "login") {
      const { error } = await signIn(email, password);
      if (error) {
        toast.error(error);
        setLoading(false);
      }
    } else {
      if (password.length < 6) {
        toast.error("Wachtwoord moet minimaal 6 tekens zijn");
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, displayName);
      if (error) {
        toast.error(error);
        setLoading(false);
      } else {
        toast.success("Account aangemaakt! Controleer je e-mail om te bevestigen.");
        setView("login");
        setLoading(false);
      }
    }
  };

  const title = view === "login" ? "Log in om verder te gaan" : view === "register" ? "Maak een account aan" : "Wachtwoord vergeten";

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, hsl(260 80% 25%) 0%, hsl(300 50% 20%) 35%, hsl(330 60% 18%) 55%, hsl(220 15% 8%) 80%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 30% 50%, hsl(260 90% 35% / 0.4) 0%, transparent 50%), radial-gradient(circle at 70% 40%, hsl(330 80% 35% / 0.3) 0%, transparent 50%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-card/60 backdrop-blur border border-border/50 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>AI-Powered App Builder</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Mellow</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 p-6 shadow-2xl space-y-4"
        >
          {view === "forgot" && (
            <button
              type="button"
              onClick={() => setView("login")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Terug naar inloggen
            </button>
          )}

          {view === "register" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Naam</label>
              <Input
                type="text"
                placeholder="Je naam"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-secondary/50 border-border/50"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">E-mail</label>
            <Input
              type="email"
              placeholder="naam@voorbeeld.nl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-secondary/50 border-border/50"
            />
          </div>

          {view !== "forgot" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Wachtwoord</label>
                {view === "login" && (
                  <button
                    type="button"
                    onClick={() => setView("forgot")}
                    className="text-xs text-primary hover:underline"
                  >
                    Wachtwoord vergeten?
                  </button>
                )}
              </div>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="bg-secondary/50 border-border/50"
              />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {view === "login" ? "Inloggen" : view === "register" ? "Account aanmaken" : "Stuur reset link"}
          </Button>

          {view !== "forgot" && (
            <p className="text-center text-xs text-muted-foreground">
              {view === "login" ? "Nog geen account? " : "Al een account? "}
              <button
                type="button"
                onClick={() => setView(view === "login" ? "register" : "login")}
                className="text-primary hover:underline font-medium"
              >
                {view === "login" ? "Registreren" : "Inloggen"}
              </button>
            </p>
          )}

          {view === "forgot" && (
            <p className="text-center text-xs text-muted-foreground">
              We sturen een link naar je e-mail waarmee je een nieuw wachtwoord kunt instellen.
            </p>
          )}
        </form>
      </div>
    </div>
  );
};

export default Auth;
