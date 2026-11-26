const assert = require("node:assert/strict");
const test = require("node:test");
const DRAFTS = require("../lib/preview-drafts");
const { renderDraftPage } = require("../lib/render-draft");
const { renderPreviewShell } = require("../lib/preview-page");
const RAZORPAY = require("../lib/razorpay");

const couple = {
  contact: "9876543210",
  bride: { firstName: "Asha", fullName: "Asha Rao" },
  groom: { firstName: "Arun", fullName: "Arun Das" },
  events: [{ name: "Wedding" }],
  images: {},
};

test("preview normalization keeps contact details out of wedding-site data", () => {
  const normalized = DRAFTS.normalizeDraft("ram-mandir", couple);
  assert.equal(normalized.phone, "9876543210");
  assert.equal(normalized.coupleNames, "Asha Rao & Arun Das");
  assert.equal("contact" in normalized.coupleData, false);
});

test("preview normalization rejects phone numbers shorter than ten digits", () => {
  assert.throws(
    () => DRAFTS.normalizeDraft("ram-mandir", { ...couple, contact: "12345" }),
    /valid contact phone number/
  );
});

test("draft HTML contains its own watermark while unpaid and removes it when paid", () => {
  const draft = {
    id: "00000000-0000-4000-8000-000000000001",
    template_id: "ram-mandir",
    status: "unpaid",
    draft_data: DRAFTS.normalizeDraft("ram-mandir", couple).coupleData,
  };
  const req = { headers: { host: "localhost:8080", "x-forwarded-proto": "http" } };
  const unpaidHtml = renderDraftPage(draft, req);
  assert.match(unpaidHtml, /srw-preview-watermark/);
  assert.match(unpaidHtml, /PAY ₹999 TO UNLOCK/);

  const paidHtml = renderDraftPage({ ...draft, status: "paid" }, req);
  assert.doesNotMatch(paidHtml, /srw-preview-watermark/);
});

test("preview shell gates opens and publishes only through the verified preview endpoint", () => {
  const html = renderPreviewShell({
    token: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.match(html, /var maxAttempts=3/);
  assert.match(html, /\/api\/publish-preview/);
  assert.doesNotMatch(html, /\/api\/public-website/);
});

test("draft checkout requires a Razorpay test-mode key", () => {
  const originalKey = process.env.RZP_KEY_ID;
  const originalLiveFlag = process.env.ALLOW_LIVE_PREVIEW_PAYMENTS;
  try {
    process.env.RZP_KEY_ID = "rzp_live_example";
    assert.equal(RAZORPAY.isTestMode(), false);
    delete process.env.ALLOW_LIVE_PREVIEW_PAYMENTS;
    assert.equal(RAZORPAY.previewPaymentsEnabled(), false);
    process.env.ALLOW_LIVE_PREVIEW_PAYMENTS = "true";
    assert.equal(RAZORPAY.previewPaymentsEnabled(), true);
    process.env.RZP_KEY_ID = "rzp_test_example";
    assert.equal(RAZORPAY.isTestMode(), true);
    process.env.ALLOW_LIVE_PREVIEW_PAYMENTS = "false";
    assert.equal(RAZORPAY.previewPaymentsEnabled(), true);
  } finally {
    if (originalKey === undefined) delete process.env.RZP_KEY_ID;
    else process.env.RZP_KEY_ID = originalKey;
    if (originalLiveFlag === undefined) delete process.env.ALLOW_LIVE_PREVIEW_PAYMENTS;
    else process.env.ALLOW_LIVE_PREVIEW_PAYMENTS = originalLiveFlag;
  }
});
