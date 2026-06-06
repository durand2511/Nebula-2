import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Wachtwoord moet minimaal 6 tekens zijn");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Wachtwoorden komen niet overeen");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast.error(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      toast.success("Wachtwoord succesvol gewijzigd!");
      setTimeout(() => navigate("/"), 2000);
    }
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">Ongeldige of verlopen reset link.</p>
          <Button onClick={() => navigate("/auth")}>Terug naar inloggen</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, hsl(260 80% 25%) 0%, hsl(300 50% 20%) 35%, hsl(330 60% 18%) 55%, hsl(220 15% 8%) 80%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-card/60 backdrop-blur border border-border/50 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>Wachtwoord herstellen</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Mellow</h1>
        </div>

        {success ? (
          <div className="rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 p-6 shadow-2xl text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <p className="text-foreground font-medium">Wachtwoord gewijzigd!</p>
            <p className="text-sm text-muted-foreground">Je wordt doorgestuurd...</p>
          </div>
        ) : (
          <form
            onSubmit={handleReset}
            className="rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 p-6 shadow-2xl space-y-4"
          >
            <p className="text-sm text-muted-foreground text-center">Kies een nieuw wachtwoord</p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nieuw wachtwoord</label>
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
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Bevestig wachtwoord</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="bg-secondary/50 border-border/50"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Wachtwoord wijzigen
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
