const sizes = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const qualities = new Set(["low", "medium", "high", "auto"]);
const formats = new Set(["png", "webp", "jpeg"]);
const backgrounds = new Set(["auto", "opaque", "transparent"]);

const stylePrompts = {
  photo: "Use natural photography lighting, realistic materials, tactile details, and a composed mobile-friendly frame.",
  poster: "Create a bold commercial poster with clear hierarchy, expressive composition, clean negative space, and polished typography-safe areas.",
  illustration: "Render as a refined editorial illustration with confident shapes, rich color contrast, and intentional texture.",
  product: "Make it suitable for product launch visuals: premium lighting, crisp silhouette, practical empty space for copy, and strong shelf appeal.",
  threeD: "Render as high-end 3D art with soft global illumination, clean geometry, and cinematic depth.",
  minimal: "Keep the image minimal, elegant, spacious, and precise, with a memorable focal point."
};

function getConfig() {
  const apiBaseUrl = normalizeApiBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com");
  return {
    model: process.env.OPENAI_IMAGE_MODEL || process.env.IMAGE_MODEL || "gpt-image-2",
    apiBaseUrl,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    sizes: Array.from(sizes),
    qualities: Array.from(qualities),
    formats: Array.from(formats)
  };
}

async function generateImage(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  const apiBaseUrl = normalizeApiBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com");
  const config = getConfig();

  if (!apiKey) {
    const error = new Error("Set OPENAI_API_KEY in Vercel environment variables first.");
    error.statusCode = 500;
    throw error;
  }

  if (typeof fetch !== "function") {
    const error = new Error("This runtime needs Node.js 18 or newer.");
    error.statusCode = 500;
    throw error;
  }

  const prompt = cleanText(input.prompt, 3200);
  if (prompt.length < 4) {
    const error = new Error("Prompt is too short.");
    error.statusCode = 400;
    throw error;
  }

  const size = sizes.has(input.size) ? input.size : "1024x1536";
  const quality = qualities.has(input.quality) ? input.quality : "medium";
  const outputFormat = formats.has(input.format) ? input.format : "png";
  const background = backgrounds.has(input.background) ? input.background : "auto";
  const style = stylePrompts[input.style] || stylePrompts.photo;
  const finalPrompt = [prompt, style, "No UI chrome, no watermarks, no brand logos unless explicitly requested."]
    .filter(Boolean)
    .join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(buildApiUrl(apiBaseUrl, "/v1/images/generations"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        prompt: finalPrompt,
        n: 1,
        size,
        quality,
        output_format: outputFormat,
        background
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error && data.error.message ? data.error.message : `OpenAI request failed with ${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }

    const item = data.data && data.data[0];
    if (!item || (!item.b64_json && !item.url)) {
      const error = new Error("OpenAI returned no image data.");
      error.statusCode = 502;
      throw error;
    }

    const mime = outputFormat === "jpg" || outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
    const image = item.b64_json ? `data:${mime};base64,${item.b64_json}` : item.url;

    return {
      image,
      mime,
      model: config.model,
      prompt,
      revisedPrompt: item.revised_prompt || "",
      created: data.created || Math.floor(Date.now() / 1000),
      usage: data.usage || null,
      options: { size, quality, outputFormat, background }
    };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Image generation timed out.");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeApiBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:") {
    const error = new Error("OPENAI_BASE_URL must use HTTPS.");
    error.statusCode = 500;
    throw error;
  }

  return url.toString().replace(/\/+$/, "");
}

function buildApiUrl(baseUrl, pathname) {
  if (baseUrl.endsWith("/v1") && pathname.startsWith("/v1/")) {
    return `${baseUrl}${pathname.slice(3)}`;
  }

  return `${baseUrl}${pathname}`;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(data);
}

module.exports = {
  generateImage,
  getConfig,
  readBody,
  sendJson
};
