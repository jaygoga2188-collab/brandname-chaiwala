const crypto = require("crypto");

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getDirectUpiConfig() {
  const upiId = requiredEnvironment("DIRECT_UPI_ID");
  const payeeName = requiredEnvironment("DIRECT_UPI_PAYEE_NAME");
  const transactionNote = String(process.env.DIRECT_UPI_TRANSACTION_NOTE || "Order Payment").trim() || "Order Payment";

  if (!/^[\w.-]+@[\w.-]+$/.test(upiId)) {
    throw new Error("DIRECT_UPI_ID is not a valid UPI ID.");
  }
  return { upiId, payeeName, transactionNote };
}

function createTransactionReference() {
  return `BC${Date.now()}${crypto.randomBytes(3).toString("hex")}`.toUpperCase();
}

function buildDirectUpiLinks({ amount, transactionReference }, config) {
  const query = new URLSearchParams({
    pa: config.upiId,
    pn: config.payeeName,
    am: Number(amount).toFixed(2),
    cu: "INR",
    tn: config.transactionNote,
    tr: transactionReference,
  }).toString();
  const phonePePayload = {
    p2pPaymentCheckoutParams: {
      checkoutType: "COLLECT",
      initialAmount: Math.round(Number(amount) * 100),
      note: { type: "text", message: config.transactionNote },
      supportedInstruments: -1,
    },
    contact: { type: "EXTERNAL_MERCHANT", name: config.payeeName, vpa: config.upiId },
  };
  const encodedPayload = encodeURIComponent(Buffer.from(JSON.stringify(phonePePayload), "utf8").toString("base64"));
  return {
    upiUri: `upi://pay?${query}`,
    phonePeNativeUri: `phonepe://native?data=${encodedPayload}&id=p2ppayment`,
    phonePeUri: `phonepe:upi://pay?${query}`,
    paytmUri: `paytmmp://cash_wallet?${query}&featuretype=money_transfer`,
  };
}

module.exports = { getDirectUpiConfig, createTransactionReference, buildDirectUpiLinks };
