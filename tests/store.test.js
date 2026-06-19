const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createStore } = require("../lib/store");
const { createBilling } = require("../lib/billing");

function freshStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "image2-store-"));
  return createStore(path.join(directory, "test.db"));
}

test("trial credits can only be claimed once per trial key", () => {
  const store = freshStore();
  const first = store.ensureAccount("11111111-1111-4111-8111-111111111111", 3, "same-device");
  const second = store.ensureAccount("22222222-2222-4222-8222-222222222222", 3, "same-device");
  assert.equal(first.credits, 3);
  assert.equal(second.credits, 0);
});

test("generation debit can be refunded", () => {
  const store = freshStore();
  const id = "33333333-3333-4333-8333-333333333333";
  store.ensureAccount(id, 3, "device-3");
  assert.equal(store.debitCredits(id, 1, "request-1"), true);
  assert.equal(store.getAccount(id).credits, 2);
  store.refundCredits(id, 1, "request-1");
  assert.equal(store.getAccount(id).credits, 3);
});

test("payment crediting is idempotent", () => {
  const store = freshStore();
  const id = "44444444-4444-4444-8444-444444444444";
  store.ensureAccount(id, 0);
  const payment = {
    sessionId: "cs_test_once",
    accountId: id,
    amountTotal: 990,
    currency: "cny",
    credits: 10
  };
  assert.equal(store.recordPayment(payment), true);
  assert.equal(store.recordPayment(payment), false);
  assert.equal(store.getAccount(id).credits, 10);
});

test("Stripe webhook signatures are verified", () => {
  const secret = "whsec_test_secret";
  const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const billing = createBilling({
    secretKey: "sk_test_secret",
    webhookSecret: secret,
    publicAppUrl: "https://example.com",
    packs: []
  });
  assert.equal(billing.parseWebhook(raw, `t=${timestamp},v1=${signature}`).type, "checkout.session.completed");
  assert.throws(() => billing.parseWebhook(raw, `t=${timestamp},v1=bad`), /签名/);
});

test("email login merges anonymous credits into the existing account", () => {
  const store = freshStore();
  const existingId = "55555555-5555-4555-8555-555555555555";
  const anonymousId = "66666666-6666-4666-8666-666666666666";
  store.ensureAccount(existingId, 3, "device-5");
  store.linkEmail(existingId, "buyer@example.com");
  store.ensureAccount(anonymousId, 3, "device-6");
  const linkedId = store.linkEmail(anonymousId, "buyer@example.com");
  assert.equal(linkedId, existingId);
  assert.equal(store.getAccount(existingId).credits, 6);
  assert.equal(store.getAccount(anonymousId).credits, 0);
});

test("login codes can be stored, rate-counted, and deleted", () => {
  const store = freshStore();
  store.saveLoginCode("user@example.com", "hash", Date.now() + 60000);
  assert.equal(store.getLoginCode("user@example.com").attempts, 0);
  store.incrementLoginAttempt("user@example.com");
  assert.equal(store.getLoginCode("user@example.com").attempts, 1);
  store.deleteLoginCode("user@example.com");
  assert.equal(store.getLoginCode("user@example.com"), null);
});
