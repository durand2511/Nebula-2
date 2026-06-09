import logoUrl from "@assets/yogilates_logo.png";

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center pt-32 px-4 pb-16 w-full max-w-4xl mx-auto text-center">
      <div className="flex justify-center mb-10">
        <img src={logoUrl} alt="Yogilates" className="h-24 w-auto" />
      </div>

      <div className="rounded-2xl border border-border px-10 py-12 max-w-3xl">
        <h1
          className="text-6xl tracking-tight leading-tight"
          style={{ fontFamily: '"DM Serif Display", serif' }}
        >
          Een app in je eigen website, gebouwd met AI
        </h1>
      </div>
    </div>
  );
}
