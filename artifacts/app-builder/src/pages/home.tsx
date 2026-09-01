import logoUrl from "../assets/nebula-logo-home.png";

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 w-full py-16 gap-10">
      <img src={logoUrl} alt="Nebula" className="h-64 md:h-96 w-auto" />
      <p className="text-sm md:text-base uppercase tracking-[0.25em] text-muted-foreground text-center">
        Web design bureau
      </p>
    </div>
  );
}
