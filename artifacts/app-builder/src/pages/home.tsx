import logoUrl from "../assets/nebula-logo.png";

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 w-full pb-28">
      <img src={logoUrl} alt="Nebula" className="h-80 md:h-[28rem] w-auto" />
    </div>
  );
}
