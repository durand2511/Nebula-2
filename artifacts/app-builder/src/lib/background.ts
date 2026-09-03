// The platform's rotating nature-photo background (switches every 3h) — shared by the layout and
// the startup splash so they always show the SAME photo.
import bg1 from "@assets/nebula-bg-1.jpeg";
import bg2 from "@assets/nebula-bg-2.jpeg";
import bg3 from "@assets/nebula-bg-3.jpeg";
import bg4 from "@assets/nebula-bg-4.jpeg";
import bg5 from "@assets/nebula-bg-5.jpeg";
import bg6 from "@assets/nebula-bg-6.jpeg";

const BACKGROUNDS = [bg1, bg2, bg3, bg4, bg5, bg6];
export const bgUrl = BACKGROUNDS[Math.floor(Date.now() / (3 * 60 * 60 * 1000)) % BACKGROUNDS.length];
