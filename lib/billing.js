const crypto = require("node:crypto");

function createBilling({ secretKey, webhookSecret, publicAppUrl, packs }) {
  async function createCheckoutSession({ accountId, packId }) {
    if (!secretKey) {
      throw statusError(503, "支付功能尚未配置");
    }

    const pack = packs.find((item) => item.id === packId);
    if (!pack) {
      throw statusError(400, "无效的点数包");
    }

    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", `${publicAppUrl}/?checkout=success`);
    body.set("cancel_url", `${publicAppUrl}/?checkout=cancelled`);
    body.set("client_reference_id", accountId);
    body.set("metadata[account_id]", accountId);
    body.set("metadata[pack_id]", pack.id);
    body.set("metadata[credits]", String(pack.credits));
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", pack.currency);
    body.set("line_items[0][price_data][unit_amount]", String(pack.amount));
    body.set("line_items[0][price_data][product_data][name]", pack.name);
    body.set("line_items[0][price_data][product_data][description]", `${pack.credits} 次图片生成额度`);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) {
      const message = data.error && data.error.message ? data.error.message : "无法创建支付页面";
      throw statusError(502, message);
    }
    return data;
  }

  function parseWebhook(rawBody, signatureHeader) {
    if (!webhookSecret) {
      throw statusError(503, "支付回调尚未配置");
    }

    const parts = Object.fromEntries(
      String(signatureHeader || "")
        .split(",")
        .map((part) => part.split("="))
        .filter(([key, value]) => key && value)
    );
    const timestamp = Number(parts.t);
    const signature = parts.v1;
    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      throw statusError(400, "无效的支付回调签名");
    }

    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const valid = safeEqual(expected, signature);
    if (!valid) {
      throw statusError(400, "支付回调签名校验失败");
    }

    return JSON.parse(rawBody);
  }

  return { createCheckoutSession, parseWebhook };
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = { createBilling };
