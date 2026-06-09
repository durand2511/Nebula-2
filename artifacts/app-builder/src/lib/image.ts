export type AttachedImage = { id: string; dataUrl: string; name: string };

export const MAX_ATTACHED_IMAGES = 4;

// Sent as the message text when the user attaches reference image(s) without
// typing any prompt. Kept in sync with the server's REFERENCE_ONLY_PROMPT so the
// optimistic chat bubble matches the persisted message.
export const REFERENCE_IMAGE_PROMPT =
  "Build an app that matches the attached reference image(s) as closely as possible.";

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.85;

/**
 * Read an image File and return a downscaled data URL suitable for sending to
 * the AI as a visual reference. Large images are resized so the payload stays
 * small (bounded request size + vision token usage). Falls back to the raw
 * data URL if canvas processing isn't possible.
 */
export async function fileToReferenceImage(file: File): Promise<AttachedImage> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const dataUrl = await downscaleDataUrl(rawDataUrl).catch(() => rawDataUrl);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    dataUrl,
    name: file.name || "image",
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
      if (scale >= 1) {
        resolve(dataUrl);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}
