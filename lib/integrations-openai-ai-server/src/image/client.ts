import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

// The image AI gateway is only needed when the website builder actually generates/edits images —
// NOT to boot the server. So we build the client LAZILY and validate the env vars on first use,
// instead of throwing at import time (that crashed the whole API on startup when the vars were
// absent, e.g. on a host where only ANTHROPIC_API_KEY is set).
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "Beeld-generatie vereist AI_INTEGRATIONS_OPENAI_API_KEY en AI_INTEGRATIONS_OPENAI_BASE_URL.",
    );
  }
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

// Backwards-compatible export: a lazy proxy so importing this module never throws; the real client
// is created (and the env vars validated) on first property access.
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (client() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await client().images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await client().images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
