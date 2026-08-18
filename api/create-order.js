const QRCode = require("qrcode");
const products = require("../products.json");
const { getDirectUpiConfig, createTransactionReference, buildDirectUpiLinks } = require("../lib/direct-upi");

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

function calculateOrder(items) {
  if (!Array.isArray(items) || !items.length || items.length > 25) throw new Error("Your cart is empty or invalid.");
  const productById = new Map(products.map((product) => [String(product.id), product]));
  let amount = 0;
  for (const item of items) {
    const product = productById.get(String(item?.id || ""));
    const quantity = Number(item?.qty);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new Error("Your cart contains an invalid product.");
    }
    amount += Number(product.price) * quantity;
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Unable to calculate your order total.");
  return Math.round(amount * 100) / 100;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  try {
    const amount = calculateOrder(req.body?.items);
    const config = getDirectUpiConfig();
    const transactionReference = createTransactionReference();
    const links = buildDirectUpiLinks({ amount, transactionReference }, config);
    const qrDataUrl = await QRCode.toDataURL(links.upiUri, { width: 360, margin: 2, errorCorrectionLevel: "M" });
    return sendJson(res, 200, {
      payment_mode: "direct_upi",
      amount,
      currency: "INR",
      transaction_reference: transactionReference,
      payee_name: config.payeeName,
      payee_upi_id: config.upiId,
      qr_data_url: qrDataUrl,
      ...links,
    });
  } catch (error) {
    console.error("Direct UPI create-order error", error);
    return sendJson(res, 400, { error: error instanceof Error ? error.message : "Unable to start payment." });
  }
};
