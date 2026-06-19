const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");

loadEnvFile(path.join(rootDir, ".env"));

const port = Number(process.env.PORT || 3000);
const imageModel = process.env.OPENAI_IMAGE_MODEL || process.env.IMAGE_MODEL || "gpt-image-2";
const apiKey = process.env.OPENAI_API_KEY;
const apiBaseUrl = normalizeApiBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com");

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

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        model: imageModel,
        apiBaseUrl,
        sizes: Array.from(sizes),
        qualities: Array.from(qualities),
        formats: Array.from(formats),
        hasApiKey: Boolean(apiKey)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, model: imageModel });
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      return handleGenerate(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return serveStatic(url.pathname, res, req.method === "HEAD");
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Image 2 Studio is running at http://localhost:${port}`);
  console.log(`Model: ${imageModel}`);
  console.log(`API base: ${apiBaseUrl}`);
});

async function handleGenerate(req, res) {
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "Set OPENAI_API_KEY in the hosting environment first."
    });
  }

  if (typeof fetch !== "function") {
    return sendJson(res, 500, {
      error: "This Node.js runtime needs fetch support. Use Node.js 18 or newer."
    });
  }

  const body = await readJson(req);
  const prompt = cleanText(body.prompt, 3200);

  if (prompt.length < 4) {
    return sendJson(res, 400, { error: "Prompt is too short." });
  }

  const size = sizes.has(body.size) ? body.size : "1024x1536";
  const quality = qualities.has(body.quality) ? body.quality : "medium";
  const outputFormat = formats.has(body.format) ? body.format : "png";
  const background = backgrounds.has(body.background) ? body.background : "auto";
  const style = stylePrompts[body.style] || stylePrompts.photo;
  const finalPrompt = [prompt, style, "No UI chrome, no watermarks, no brand logos unless explicitly requested."]
    .filter(Boolean)
    .join("\n\n");

  const payload = {
    model: imageModel,
    prompt: finalPrompt,
    n: 1,
    size,
    quality,
    output_format: outputFormat,
    background
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(buildApiUrl(apiBaseUrl, "/v1/images/generations"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error && data.error.message ? data.error.message : `OpenAI request failed with ${response.status}`;
      return sendJson(res, response.status, { error: message, status: response.status });
    }

    const item = data.data && data.data[0];
    if (!item || (!item.b64_json && !item.url)) {
      return sendJson(res, 502, { error: "OpenAI returned no image data." });
    }

    const mime = outputFormat === "jpg" || outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
    const imageUrl = item.b64_json ? `data:${mime};base64,${item.b64_json}` : item.url;

    return sendJson(res, 200, {
      image: imageUrl,
      mime,
      model: imageModel,
      prompt,
      revisedPrompt: item.revised_prompt || "",
      created: data.created || Math.floor(Date.now() / 1000),
      usage: data.usage || null,
      options: { size, quality, outputFormat, background }
    });
  } catch (error) {
    const message = error.name === "AbortError" ? "Image generation timed out." : error.message;
    return sendJson(res, 500, { error: message });
  } finally {
    clearTimeout(timeout);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 16000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
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
    throw new Error("OPENAI_BASE_URL must use HTTPS.");
  }

  return url.toString().replace(/\/+$/, "");
}

function buildApiUrl(baseUrl, pathname) {
  if (baseUrl.endsWith("/v1") && pathname.startsWith("/v1/")) {
    return `${baseUrl}${pathname.slice(3)}`;
  }

  return `${baseUrl}${pathname}`;
}

function serveStatic(pathname, res, headOnly) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(publicDir, `.${requested}`);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      return sendFile(path.join(publicDir, "index.html"), res, headOnly);
    }

    return sendFile(filePath, res, headOnly);
  });
}

function sendFile(filePath, res, headOnly) {
  const ext = path.extname(filePath).toLowerCase();
  const type = mimeTypes[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
  });

  if (headOnly) {
    return res.end();
  }

  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
