const { generateImage, readBody, sendJson } = require("./_openai-image");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const result = await generateImage(body);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message || "Server error"
    });
  }
};
