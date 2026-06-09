import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Globe, Sparkles, Puzzle } from "lucide-react";
import logoUrl from "@assets/yogilates_logo.png";

const STEPS = [
  {
    icon: Globe,
    title: "Plak je website",
    description: "Geef de link van je bestaande website.",
  },
  {
    icon: Sparkles,
    title: "AI bouwt je app",
    description: "Yogilates maakt er met AI automatisch een complete app bij.",
  },
  {
    icon: Puzzle,
    title: "In je site geïntegreerd",
    description: "Je krijgt een simpele app, naadloos in je website verwerkt.",
  },
];

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center pt-24 px-4 pb-16 w-full max-w-4xl mx-auto text-center">
      <div className="flex justify-center mb-10">
        <img src={logoUrl} alt="Yogilates" className="h-24 w-auto" />
      </div>

      <h1 className="text-4xl font-semibold tracking-tight mb-4 max-w-2xl">
        Een app in je eigen website — gebouwd met AI
      </h1>
      <p className="text-muted-foreground text-lg leading-relaxed max-w-xl mb-10">
        Plak de link van je website. Yogilates bouwt er met AI een complete app
        bij en integreert die naadloos in je site. Zo heb je in een paar klikken
        een werkende app in je website.
      </p>

      <Link href="/ai-editor">
        <Button size="lg" className="h-12 px-8 font-bold" data-testid="button-start">
          Begin nu
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </Link>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-3xl mt-20">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="bg-card rounded-xl border border-border shadow-sm p-6 flex flex-col items-center text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background shadow-sm mb-4">
              <step.icon className="h-6 w-6 text-foreground" />
            </div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">
              Stap {i + 1}
            </div>
            <h3 className="text-base font-semibold tracking-tight mb-1.5">
              {step.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
