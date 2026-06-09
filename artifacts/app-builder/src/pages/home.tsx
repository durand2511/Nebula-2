import logoUrl from "@assets/yogilates_logo.png";

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 w-full">
      <img src={logoUrl} alt="Yogilates" className="h-32 w-auto" />
    </div>
  );
}
