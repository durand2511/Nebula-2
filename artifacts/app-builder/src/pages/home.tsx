import logoUrl from "../assets/nebula-logo-home.png";
import whereStarsUrl from "../assets/where-stars.png";

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 w-full py-16 gap-10">
      <img src={logoUrl} alt="Nebula" className="h-64 md:h-96 w-auto" />
      <img
        src={whereStarsUrl}
        alt="Where stars are born and develop"
        className="w-full max-w-lg rounded-3xl shadow-xl"
      />
    </div>
  );
}
