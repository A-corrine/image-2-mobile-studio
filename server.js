const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createStore } = require("./lib/store");
const { createBilling } = require("./lib/billing");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");

loadEnvFile(path.join(rootDir, ".env"));

const port = Number(process.env.PORT || 3000);
const imageModel = process.env.OPENAI_IMAGE_MODEL || process.env.IMAGE_MODEL || "gpt-image-2";
const apiKey = process.env.OPENAI_API_KEY;
const apiBaseUrl = normalizeApiBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com");
const appSecret = process.env.APP_SECRET || crypto.createHash("sha256").update(apiKey || "image-2-local-development").digest("hex");
const databasePath = process.env.DATABASE_PATH || path.join(rootDir, "data", "app.db");
const starterCredits = Math.max(0, Number(process.env.STARTER_CREDITS || 3));
const billingLive = process.env.BILLING_ENABLED === "true";
const businessName = cleanText(process.env.BUSINESS_NAME || "Image 2 Studio", 80);
const supportEmail = normalizeEmail(process.env.SUPPORT_EMAIL);
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const publicAppUrl = normalizePublicUrl(
  process.env.PUBLIC_APP_URL ||
    (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:${port}`)
);
const creditPacks = [
  { id: "starter", name: "轻量包", credits: 10, amount: 990, currency: "cny", label: "¥9.90" },
  { id: "creator", name: "创作包", credits: 50, amount: 2990, currency: "cny", label: "¥29.90" },
  { id: "studio", name: "工作室包", credits: 120, amount: 5990, currency: "cny", label: "¥59.90" }
];
const store = createStore(databasePath);
const billing = createBilling({
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  publicAppUrl,
  packs: creditPacks
});
const activeGenerations = new Set();
const authRequestWindows = new Map();
const adminFailureWindows = new Map();

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
        hasApiKey: Boolean(apiKey),
        businessName,
        supportEmail
      });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, model: imageModel });
    }

    if (req.method === "GET" && url.pathname === "/api/account") {
      const account = getOrCreateAccount(req, res);
      return sendJson(res, 200, publicAccount(account));
    }

    if (req.method === "GET" && url.pathname === "/api/admin/summary") {
      if (!authorizeAdmin(req, res)) {
        return;
      }
      return sendJson(res, 200, { ...store.getAdminSummary(), generatedAt: Date.now() });
    }

    if (req.method === "POST" && url.pathname === "/api/checkout") {
      return handleCheckout(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/request") {
      return handleAuthRequest(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify") {
      return handleAuthVerify(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      clearAccountCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/stripe/webhook") {
      return handleStripeWebhook(req, res);
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
    return sendJson(res, error.statusCode || 500, { error: error.message || "Server error" });
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

  const account = getOrCreateAccount(req, res);
  const requestId = crypto.randomUUID();
  if (activeGenerations.has(account.id)) {
    return sendJson(res, 429, { error: "已有图片正在生成，请稍候" });
  }
  if (!store.debitCredits(account.id, 1, requestId)) {
    return sendJson(res, 402, {
      error: "点数不足，请先购买点数",
      code: "INSUFFICIENT_CREDITS",
      account: publicAccount(store.getAccount(account.id))
    });
  }
  activeGenerations.add(account.id);

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
      const requestError = new Error(message);
      requestError.statusCode = response.status;
      throw requestError;
    }

    const item = data.data && data.data[0];
    if (!item || (!item.b64_json && !item.url)) {
      const responseError = new Error("OpenAI returned no image data.");
      responseError.statusCode = 502;
      throw responseError;
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
      options: { size, quality, outputFormat, background },
      account: publicAccount(store.getAccount(account.id))
    });
  } catch (error) {
    store.refundCredits(account.id, 1, requestId);
    const message = error.name === "AbortError" ? "Image generation timed out." : error.message;
    const status = error.name === "AbortError" ? 504 : error.statusCode || 500;
    return sendJson(res, status, {
      error: message,
      account: publicAccount(store.getAccount(account.id))
    });
  } finally {
    clearTimeout(timeout);
    activeGenerations.delete(account.id);
  }
}

async function handleCheckout(req, res) {
  const account = getOrCreateAccount(req, res);
  if (!billingLive || !supportEmail) {
    return sendJson(res, 503, { error: "支付功能尚未开放" });
  }
  if (!account.email) {
    return sendJson(res, 401, { error: "请先验证邮箱再购买点数", code: "EMAIL_REQUIRED" });
  }
  const body = await readJson(req);
  const session = await billing.createCheckoutSession({ accountId: account.id, packId: cleanText(body.packId, 32) });
  return sendJson(res, 200, { url: session.url });
}

async function handleAuthRequest(req, res) {
  const account = getOrCreateAccount(req, res);
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) {
    return sendJson(res, 400, { error: "请输入有效邮箱" });
  }
  if (!canRequestLoginCode(req, email)) {
    return sendJson(res, 429, { error: "验证码发送过于频繁，请稍后再试" });
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return sendJson(res, 503, { error: "邮箱登录功能尚未配置" });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashLoginCode(email, code);
  store.saveLoginCode(email, codeHash, Date.now() + 10 * 60 * 1000);
  await sendLoginCode(email, code);
  return sendJson(res, 200, { ok: true, expiresIn: 600, account: publicAccount(account) });
}

async function handleAuthVerify(req, res) {
  const account = getOrCreateAccount(req, res);
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return sendJson(res, 400, { error: "邮箱或验证码格式不正确" });
  }

  const loginCode = store.getLoginCode(email);
  if (!loginCode || loginCode.expires_at < Date.now() || loginCode.attempts >= 5) {
    store.deleteLoginCode(email);
    return sendJson(res, 400, { error: "验证码无效或已过期" });
  }

  const expected = Buffer.from(loginCode.code_hash);
  const received = Buffer.from(hashLoginCode(email, code));
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    store.incrementLoginAttempt(email);
    return sendJson(res, 400, { error: "验证码不正确" });
  }

  const linkedAccountId = store.linkEmail(account.id, email);
  setAccountCookie(res, linkedAccountId);
  return sendJson(res, 200, { ok: true, account: publicAccount(store.getAccount(linkedAccountId)) });
}

async function handleStripeWebhook(req, res) {
  const rawBody = await readRaw(req, 1024 * 1024);
  const event = billing.parseWebhook(rawBody, req.headers["stripe-signature"]);

  if (event.type === "checkout.session.completed") {
    const session = event.data && event.data.object;
    const metadata = session && session.metadata;
    const pack = creditPacks.find((item) => item.id === (metadata && metadata.pack_id));
    const accountId = metadata && metadata.account_id;
    const isValid =
      session &&
      session.payment_status === "paid" &&
      accountId &&
      pack &&
      Number(session.amount_total) === pack.amount &&
      String(session.currency).toLowerCase() === pack.currency;

    if (isValid) {
      store.ensureAccount(accountId, 0);
      store.recordPayment({
        sessionId: session.id,
        paymentIntent: session.payment_intent,
        accountId,
        amountTotal: pack.amount,
        currency: pack.currency,
        credits: pack.credits
      });
    }
  }

  if (event.type === "charge.refunded") {
    const charge = event.data && event.data.object;
    if (charge && charge.payment_intent && charge.amount_refunded > 0 && charge.currency) {
      store.recordRefund({
        paymentIntent: charge.payment_intent,
        amountRefunded: Number(charge.amount_refunded),
        currency: String(charge.currency).toLowerCase()
      });
    }
  }

  return sendJson(res, 200, { received: true });
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

function readRaw(req, maxLength) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxLength) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function getOrCreateAccount(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const accountId = verifyAccountToken(cookies.image2_account) || crypto.randomUUID();
  const account = store.ensureAccount(accountId, starterCredits, trialKeyForRequest(req));
  if (!cookies.image2_account || !verifyAccountToken(cookies.image2_account)) {
    setAccountCookie(res, accountId);
  }
  return account;
}

function setAccountCookie(res, accountId) {
  appendHeader(
    res,
    "Set-Cookie",
    `image2_account=${signAccountToken(accountId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  );
}

function clearAccountCookie(res) {
  appendHeader(
    res,
    "Set-Cookie",
    `image2_account=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

function trialKeyForRequest(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwarded || (req.socket && req.socket.remoteAddress) || "unknown";
  const agent = String(req.headers["user-agent"] || "unknown").slice(0, 240);
  return crypto.createHmac("sha256", appSecret).update(`${address}\n${agent}`).digest("hex");
}

function publicAccount(account) {
  return {
    email: account && account.email ? account.email : null,
    isAuthenticated: Boolean(account && account.email),
    credits: account ? account.credits : 0,
    generationCost: 1,
    starterCredits,
    authEnabled: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    billingEnabled: Boolean(
      billingLive && supportEmail && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
    ),
    packs: creditPacks.map(({ id, name, credits, label }) => ({ id, name, credits, label }))
  };
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "";
  }
  return email;
}

function authorizeAdmin(req, res) {
  if (adminPassword.length < 16) {
    sendJson(res, 503, { error: "管理后台尚未配置" });
    return false;
  }

  const failureKey = trialKeyForRequest(req);
  const now = Date.now();
  const recent = (adminFailureWindows.get(failureKey) || []).filter((time) => time > now - 15 * 60 * 1000);
  if (recent.length >= 10) {
    sendJson(res, 429, { error: "登录尝试过多，请稍后再试" });
    return false;
  }

  const authorization = String(req.headers.authorization || "");
  let username = "";
  let password = "";
  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      username = separator === -1 ? decoded : decoded.slice(0, separator);
      password = separator === -1 ? "" : decoded.slice(separator + 1);
    } catch {
      password = "";
    }
  }

  const expected = Buffer.from(adminPassword);
  const received = Buffer.from(password || "");
  const valid = username === "admin" && expected.length === received.length && crypto.timingSafeEqual(expected, received);
  if (!valid) {
    recent.push(now);
    adminFailureWindows.set(failureKey, recent);
    res.setHeader("WWW-Authenticate", 'Basic realm="Image 2 Studio Admin"');
    sendJson(res, 401, { error: "管理员密码不正确" });
    return false;
  }

  adminFailureWindows.delete(failureKey);
  return true;
}

function hashLoginCode(email, code) {
  return crypto.createHmac("sha256", appSecret).update(`${email}\n${code}`).digest("hex");
}

function canRequestLoginCode(req, email) {
  const key = `${trialKeyForRequest(req)}:${email}`;
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const recent = (authRequestWindows.get(key) || []).filter((time) => time > windowStart);
  if (recent.length >= 3) {
    return false;
  }
  recent.push(now);
  authRequestWindows.set(key, recent);
  return true;
}

async function sendLoginCode(email, code) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject: "Image 2 Studio 登录验证码",
      html: `<div style="font-family:Arial,sans-serif;color:#161a22"><h2>登录验证码</h2><p>你的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>10 分钟内有效。请勿转发给他人。</p></div>`
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || (data.error && data.error.message) || "验证码邮件发送失败";
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }
}

function signAccountToken(accountId) {
  const signature = crypto.createHmac("sha256", appSecret).update(accountId).digest("base64url");
  return `${accountId}.${signature}`;
}

function verifyAccountToken(token) {
  const [accountId, signature] = String(token || "").split(".");
  if (!/^[0-9a-f-]{36}$/i.test(accountId || "") || !signature) {
    return null;
  }
  const expected = crypto.createHmac("sha256", appSecret).update(accountId).digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && crypto.timingSafeEqual(left, right) ? accountId : null;
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function appendHeader(res, name, value) {
  const current = res.getHeader(name);
  res.setHeader(name, current ? [].concat(current, value) : value);
}

function normalizePublicUrl(value) {
  const url = new URL(String(value || "").trim());
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("PUBLIC_APP_URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/+$/, "");
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

  applySecurityHeaders(res);
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
  applySecurityHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function applySecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
