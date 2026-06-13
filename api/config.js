const { getConfig, sendJson } = require("./_openai-image");

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 200, getConfig());
};
