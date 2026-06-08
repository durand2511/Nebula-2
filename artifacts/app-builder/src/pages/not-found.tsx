import { FileQuestion } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background p-4 text-center">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full shadow-2xl">
        <FileQuestion className="h-16 w-16 text-muted-foreground mx-auto mb-6 opacity-80" />
        <h1 className="text-4xl font-bold tracking-tight mb-2 text-foreground">404</h1>
        <h2 className="text-xl font-semibold mb-4 text-foreground/80">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          The page or project you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/">
          <Button size="lg" className="w-full">
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
