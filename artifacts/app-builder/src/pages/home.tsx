import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import logoUrl from "@assets/yogilates_logo.png";

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center pt-32 px-4 pb-16 w-full max-w-4xl mx-auto text-center">
      <div className="flex justify-center mb-10">
        <img src={logoUrl} alt="Yogilates" className="h-24 w-auto" />
      </div>

      <h1
        className="text-6xl tracking-tight mb-6 max-w-3xl leading-tight"
        style={{ fontFamily: '"Abril Fatface", serif' }}
      >
        Een app in je eigen website, gebouwd met AI
      </h1>
      <p
        className="text-muted-foreground text-xl leading-relaxed max-w-xl mb-12"
        style={{ fontFamily: '"Fraunces", serif' }}
      >
        Plak de link van je website. Yogilates bouwt er met AI een complete app
        bij en integreert die naadloos in je site. Zo heb je in een paar klikken
        een werkende app in je website.
      </p>

      <Link href="/ai-editor">
        <Button size="lg" className="h-12 px-8 font-bold" data-testid="button-start">
          Begin nu
        </Button>
      </Link>
    </div>
  );
}
