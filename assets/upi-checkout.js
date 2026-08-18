(() => {
  const methods = [
    { id: "phonepe", label: "PhonePe", logo: "/assets/payment-logos/phonepe.png" },
  ];

  function readCheckoutData() {
    const cart = JSON.parse(localStorage.getItem("nexshop_cart") || "[]");
    const customer = JSON.parse(sessionStorage.getItem("address") || "{}");
    const items = Array.isArray(cart) ? cart.map(({ id, qty }) => ({ id, qty })) : [];
    return { items, customer };
  }

  function formatAmount(amount) {
    return Number.isFinite(amount) ? `₹${amount.toFixed(2)}` : "₹—";
  }

  async function loadDisplayAmount(ui) {
    try {
      const checkout = readCheckoutData();
      const response = await fetch("/products.json", { cache: "force-cache" });
      if (!response.ok) return;
      const products = await response.json();
      const prices = new Map(products.map((product) => [Number(product.id), Number(product.price)]));
      const amount = checkout.items.reduce((total, item) => total + (prices.get(Number(item.id)) || 0) * Number(item.qty || 0), 0);
      if (!Number.isFinite(amount) || amount <= 0) return;
      ui.amountNodes.forEach((node) => { node.textContent = formatAmount(amount); });
    } catch (_) {
      // The server remains the source of truth and validates the amount on pay.
    }
  }

  function setLoading(ui, loading) {
    if (ui.payButton) {
      ui.payButton.disabled = loading;
      ui.payButton.classList.toggle("is-loading", loading);
      const payCopy = ui.payButton.querySelector(".direct-upi-pay-copy");
      if (payCopy) {
        payCopy.textContent = loading ? "Please wait..." : "PayNow";
      } else if (ui.directTrigger) {
        if (!ui.originalButtonText) ui.originalButtonText = ui.payButton.textContent;
        ui.payButton.textContent = loading ? "Opening PhonePe..." : ui.originalButtonText;
      }
    }
    (ui.methods || []).forEach((button) => { button.disabled = loading; });
    if (ui.qrButton) ui.qrButton.disabled = loading;
  }

  function hideStatus(ui) {
    if (!ui.status) return;
    ui.status.hidden = true;
    ui.status.className = "direct-upi-status";
  }

  function showStatus(ui, type, title, message) {
    setLoading(ui, false);
    if (!ui.status) {
      window.alert(`${title}\n\n${message}`);
      return;
    }
    ui.status.className = `direct-upi-status is-${type}`;
    ui.status.querySelector(".direct-upi-status-icon").textContent = type === "error" ? "!" : "i";
    ui.status.querySelector(".direct-upi-status-title").textContent = title;
    ui.status.querySelector(".direct-upi-status-copy").textContent = message;
    const retryButton = ui.status.querySelector(".direct-upi-retry");
    retryButton.textContent = type === "pending" ? "Check Status" : "Try Again";
    ui.status.hidden = false;
    ui.status.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function showQr(ui, result) {
    const previous = document.querySelector(".direct-upi-qr-modal");
    if (previous) previous.remove();
    const modal = document.createElement("div");
    modal.className = "direct-upi-qr-modal";
    modal.innerHTML = `<section class="direct-upi-qr-card" role="dialog" aria-modal="true" aria-label="Scan UPI QR code"><button type="button" class="direct-upi-qr-close" aria-label="Close">×</button><h2>Scan & Pay</h2><p>Scan this Paytm UPI QR code from your payment app.</p><img src="${result.qr_data_url}" alt="UPI payment QR code"><strong>${formatAmount(Number(result.amount))}</strong><small>Reference: ${result.transaction_reference}</small></section>`;
    const close = () => { modal.remove(); ui.paymentLaunched = false; };
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    modal.querySelector(".direct-upi-qr-close").addEventListener("click", close);
    document.body.appendChild(modal);
  }

  async function startPayment(ui, method) {
    if (ui.paymentLaunched) return;
    let checkout;
    try {
      checkout = readCheckoutData();
    } catch (_) {
      showStatus(ui, "error", "Cart details unavailable", "Please refresh the page and try again.");
      return;
    }

    if (!checkout.items.length) {
      showStatus(ui, "error", "Your cart is empty", "Add a product to your cart before starting payment.");
      return;
    }

    hideStatus(ui);
    setLoading(ui, true);

    try {
      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkout),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.upiUri || !result.phonePeUri || !result.qr_data_url) {
        throw new Error(result.error || "Unable to start payment.");
      }
      if (Number.isFinite(Number(result.amount))) {
        ui.amountNodes.forEach((node) => { node.textContent = formatAmount(Number(result.amount)); });
      }
      const reference = result.transaction_reference;
      sessionStorage.setItem("upi_order_reference", reference);
      sessionStorage.setItem("upi_payment_attempt", JSON.stringify({
        reference,
        gateway: "direct_upi",
        preferredMethod: method.id,
        amount: Number(result.amount) || 0,
        currency: result.currency || "INR",
        startedAt: Date.now(),
      }));
      ui.paymentLaunched = true;
      if (method.id === "qr") {
        showQr(ui, result);
        return;
      }
      const target = /Android/i.test(navigator.userAgent) ? result.phonePeNativeUri : result.phonePeUri;
      if (!target) throw new Error("PhonePe payment link is unavailable.");
      window.location.assign(target);
      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          ui.paymentLaunched = false;
          showStatus(ui, "pending", "Payment request opened", "Complete the payment in PhonePe. This direct UPI payment is not marked successful by a browser return.");
        }
      }, 2200);
    } catch (error) {
      ui.paymentLaunched = false;
      showStatus(ui, "error", "Payment could not start", error.message || "Please check your connection and try again.");
    }
  }

  const directCheckoutUi = {
    payButton: null,
    qrButton: null,
    status: null,
    amountNodes: [],
    methods: [],
    paymentLaunched: false,
    directTrigger: true,
    originalButtonText: "",
    lastVerificationPayload: null,
  };

  window.startDirectUpiCheckout = async (triggerButton) => {
    directCheckoutUi.payButton = triggerButton || null;
    directCheckoutUi.originalButtonText = triggerButton?.textContent || "Save Address and Continue";
    await startPayment(directCheckoutUi, {
      id: "phonepe",
      label: "PhonePe",
      logo: "",
    });
  };

  function showUpiCheckout() {
    if (location.pathname !== "/payment") return;
    const page = document.querySelector(".pm-main");
    if (!page || page.dataset.directUpiReady) return;
    page.dataset.directUpiReady = "true";

    const style = document.createElement("style");
    style.textContent = `
      .pm-main::before{display:none!important}
      .pm-main>*{display:none!important}
      .pm-main>.direct-upi-checkout{display:block!important}
      .direct-upi-checkout{--pay-purple:#a21d8e;--pay-purple-dark:#8e147a;display:block!important;min-height:100vh;padding:0 0 94px;background:#f5f5f5;color:#242124;font-family:Inter,Arial,sans-serif;box-sizing:border-box}
      .direct-upi-page{width:100%;max-width:560px;min-height:100vh;margin:0 auto;background:#f5f5f5;box-shadow:0 0 34px rgba(53,32,49,.08)}
      .direct-upi-topbar{display:flex!important;align-items:center;height:62px;padding:0 18px;background:var(--pay-purple);color:#fff}
      .direct-upi-back{display:grid!important;place-items:center;width:34px;height:42px;margin-right:5px;border:0;background:transparent;color:#fff;cursor:pointer}.direct-upi-back svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
      .direct-upi-wordmark{font-size:13px;font-weight:800;letter-spacing:-.25px}.direct-upi-top-actions{display:flex!important;align-items:center;gap:17px;margin-left:auto}.direct-upi-top-actions svg{width:27px;height:27px;fill:currentColor}.direct-upi-cart-icon{position:relative;display:grid!important;place-items:center}.direct-upi-cart-badge{position:absolute;right:-7px;top:-8px;display:grid!important;place-items:center;min-width:18px;height:18px;padding:0 4px;border:2px solid var(--pay-purple);border-radius:50%;background:#fff;color:var(--pay-purple);font-size:9px;font-weight:800}
      .direct-upi-steps{position:relative;display:grid!important;grid-template-columns:repeat(4,1fr);padding:17px 17px 14px;background:#fff;border-bottom:8px solid #f5f5f5}.direct-upi-steps::before{content:"";position:absolute;left:12.5%;right:12.5%;top:35px;height:1px;background:#ddd;z-index:0}.direct-upi-step{position:relative;z-index:1;display:flex!important;flex-direction:column;align-items:center;gap:6px;color:#aaa;font-size:11px;font-weight:700}.direct-upi-step-circle{display:grid!important;place-items:center;width:34px;height:34px;border:2px solid #cfcfcf;border-radius:50%;background:#fff;color:#aaa;font-size:13px}.direct-upi-step.done,.direct-upi-step.active{color:var(--pay-purple)}.direct-upi-step.done .direct-upi-step-circle,.direct-upi-step.active .direct-upi-step-circle{border-color:var(--pay-purple);color:var(--pay-purple)}.direct-upi-step.done .direct-upi-step-circle{font-size:0}.direct-upi-step.done .direct-upi-step-circle::after{content:"✓";font-size:15px;font-weight:800}
      .direct-upi-title-row{display:flex!important;align-items:center;justify-content:space-between;gap:12px;padding:19px 17px;background:#fff;border-bottom:8px solid #f5f5f5}.direct-upi-title-row h1{margin:0;font-size:18px;line-height:1.25;font-weight:800;letter-spacing:-.3px}.direct-upi-safe{display:flex!important;align-items:center;gap:7px;color:#4f4c50;font-size:10px;font-weight:800;line-height:1.15;text-align:left}.direct-upi-safe svg{width:22px;height:26px;fill:#2868d7}
      .direct-upi-online{padding:16px 17px 13px;background:#fff;border-bottom:1px solid #eee;font-size:13px;font-weight:800;letter-spacing:.2px}.direct-upi-upi-title{display:flex!important;align-items:center;gap:9px;padding:14px 17px;background:#fff;border-bottom:1px solid #eee;font-size:14px;font-weight:700}.direct-upi-upi-chip{padding:3px 7px;border-radius:4px;background:#1aab64;color:#fff;font-size:10px;font-weight:800}
      .direct-upi-methods{display:block!important;background:#fff}.direct-upi-method{display:flex!important;align-items:center;width:100%;min-height:73px;padding:11px 17px;border:0;border-bottom:1px solid #eee;background:#fff;color:#353135;text-align:left;cursor:pointer}.direct-upi-method.selected{background:#fff9ff}.direct-upi-method:disabled{opacity:.65;cursor:wait}.direct-upi-radio{display:grid!important;place-items:center;flex:0 0 auto;width:22px;height:22px;margin-right:14px;border:2px solid #cfcfcf;border-radius:50%}.selected .direct-upi-radio{border-color:var(--pay-purple)}.selected .direct-upi-radio::after{content:"";width:12px;height:12px;border-radius:50%;background:var(--pay-purple)}.direct-upi-method-label{flex:1;font-size:15px;font-weight:500}.direct-upi-method-logo{display:grid!important;place-items:center;width:51px;height:45px;margin-left:10px}.direct-upi-method-logo img{display:block;width:auto;height:auto;max-width:47px;max-height:39px;object-fit:contain}.direct-upi-method-logo.logo-gpay{justify-content:start;overflow:hidden}.direct-upi-method-logo.logo-gpay img{width:251px;max-width:none;height:45px;max-height:none;object-fit:fill}.direct-upi-method-logo.logo-phonepe img{max-width:39px;max-height:39px}.direct-upi-method-logo.logo-paytm img{width:43px;height:43px;border-radius:50%}.direct-upi-method-logo.logo-whatsapp img{width:43px;height:43px}
      .direct-upi-qr{display:flex!important;align-items:center;width:100%;min-height:52px;padding:0 17px;border:0;border-bottom:8px solid #f5f5f5;background:#fff;color:var(--pay-purple);font-size:13px;font-weight:800;cursor:pointer;text-align:left}.direct-upi-qr svg{width:19px;height:19px;margin-right:10px;fill:currentColor}.direct-upi-qr.is-selected{background:#fff5fd}.direct-upi-qr span:last-child{margin-left:auto;font-size:16px}
      .direct-upi-status{display:flex!important;align-items:flex-start;gap:10px;margin:8px 12px 0;padding:11px 12px;border-radius:9px}.direct-upi-status[hidden]{display:none!important}.direct-upi-status.is-error{color:#9d1c26;background:#fff2f3;border:1px solid #ffd2d5}.direct-upi-status.is-pending{color:#76510a;background:#fff9e9;border:1px solid #f7e0a2}.direct-upi-status-icon{display:grid!important;place-items:center;flex:0 0 auto;width:23px;height:23px;border-radius:50%;color:#fff;font-size:12px;font-weight:800}.is-error .direct-upi-status-icon{background:#c73342}.is-pending .direct-upi-status-icon{background:#9a6b0d}.direct-upi-status-text{flex:1}.direct-upi-status-title{display:block;font-size:11px}.direct-upi-status-copy{margin:3px 0 7px;font-size:9.5px;line-height:1.45}.direct-upi-retry{padding:6px 10px;border:1px solid currentColor;border-radius:7px;background:#fff;color:inherit;font-size:10px;font-weight:800;cursor:pointer}
      .direct-upi-qr-modal{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;padding:18px;background:rgba(27,15,25,.58)}.direct-upi-qr-card{position:relative;width:min(100%,350px);padding:28px 22px 23px;border-radius:20px;background:#fff;text-align:center;box-shadow:0 20px 65px rgba(0,0,0,.28)}.direct-upi-qr-card h2{margin:0;color:#202020;font-size:20px}.direct-upi-qr-card p{margin:8px 0 16px;color:#626062;font-size:12px;line-height:1.45}.direct-upi-qr-card img{display:block;width:220px;height:220px;margin:0 auto 15px;border:7px solid #f5f5f5;border-radius:10px}.direct-upi-qr-card strong,.direct-upi-qr-card small{display:block}.direct-upi-qr-card strong{font-size:20px}.direct-upi-qr-card small{margin-top:6px;color:#777;font-size:10px}.direct-upi-qr-close{position:absolute;right:12px;top:10px;width:32px;height:32px;border:0;border-radius:50%;background:#f2eef1;color:#4d454b;font-size:25px;line-height:1;cursor:pointer}
      .direct-upi-price-card{margin-top:8px;padding:14px 17px 18px;background:#fff}.direct-upi-price-row{display:flex!important;align-items:center;justify-content:space-between;min-height:40px;border-bottom:1px solid #eee;font-size:14px}.direct-upi-price-row:last-child{border-bottom:0}.direct-upi-price-row span:first-child{color:#555056;font-weight:600}.direct-upi-price-row strong{color:#191719;font-size:15px}.direct-upi-price-row .direct-upi-free{color:#0b9c4b}.direct-upi-price-row.total span:first-child,.direct-upi-price-row.total strong{color:#191719;font-size:15px;font-weight:800}
      .direct-upi-bottom{position:fixed;left:50%;bottom:0;z-index:1200;display:flex!important;align-items:center;justify-content:space-between;width:min(100%,560px);min-height:82px;padding:11px 17px calc(11px + env(safe-area-inset-bottom));border-top:1px solid #eee;background:#fff;box-shadow:0 -4px 16px rgba(0,0,0,.08);transform:translateX(-50%);box-sizing:border-box}.direct-upi-footer-price strong,.direct-upi-footer-price small{display:block}.direct-upi-footer-price strong{color:#111;font-size:20px;line-height:1.15}.direct-upi-footer-price small{margin-top:3px;color:var(--pay-purple);font-size:9px;font-weight:800;text-transform:uppercase}.direct-upi-pay{display:flex!important;align-items:center;justify-content:center;min-width:122px;min-height:52px;padding:0 20px;border:0;border-radius:10px;background:var(--pay-purple);color:#fff;font-size:16px;font-weight:800;cursor:pointer}.direct-upi-pay:active{background:var(--pay-purple-dark)}.direct-upi-pay:disabled{opacity:.7;cursor:wait}.direct-upi-pay.is-loading::before{content:"";width:15px;height:15px;margin-right:8px;border:2px solid #ffffff66;border-top-color:#fff;border-radius:50%;animation:directUpiSpin .8s linear infinite}
      @keyframes directUpiSpin{to{transform:rotate(360deg)}}
      @media(max-width:360px){.direct-upi-topbar{height:58px;padding-inline:13px}.direct-upi-title-row{padding-inline:13px}.direct-upi-title-row h1{font-size:16px}.direct-upi-method{padding-inline:14px}.direct-upi-method-label{font-size:14px}.direct-upi-bottom{padding-inline:14px}.direct-upi-pay{min-width:112px}}
      @media(min-width:561px){.direct-upi-page{border-right:1px solid #eee;border-left:1px solid #eee}.direct-upi-checkout{padding:14px 0 100px}.direct-upi-page{border-radius:15px 15px 0 0;overflow:hidden}}
    `;
    document.head.appendChild(style);

    let cartCount = 0;
    try {
      cartCount = readCheckoutData().items.reduce((total, item) => total + Number(item.qty || 0), 0);
    } catch (_) {
      cartCount = 0;
    }

    const section = document.createElement("section");
    section.className = "direct-upi-checkout";
    section.innerHTML = `
      <div class="direct-upi-page">
        <header class="direct-upi-topbar">
          <button class="direct-upi-back" type="button" aria-label="Go back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
          <span class="direct-upi-wordmark">Brandname Chaiwala</span>
          <span class="direct-upi-top-actions"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.35-9.33-8.29C.72 9.41 2.08 5 6.3 5A5.4 5.4 0 0 1 12 9.1 5.4 5.4 0 0 1 17.7 5c4.22 0 5.58 4.41 3.63 7.71C19 16.65 12 21 12 21Z"/></svg><span class="direct-upi-cart-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 3h2l2.4 10.4A2 2 0 0 0 9.35 15H17a2 2 0 0 0 1.9-1.37L21 7H6"/></svg><b class="direct-upi-cart-badge">${cartCount}</b></span></span>
        </header>
        <div class="direct-upi-steps">
          <span class="direct-upi-step done"><b class="direct-upi-step-circle">1</b><span>Cart</span></span>
          <span class="direct-upi-step done"><b class="direct-upi-step-circle">2</b><span>Address</span></span>
          <span class="direct-upi-step active"><b class="direct-upi-step-circle">3</b><span>Payment</span></span>
          <span class="direct-upi-step"><b class="direct-upi-step-circle">4</b><span>Summary</span></span>
        </div>
        <div class="direct-upi-title-row"><h1>Select Payment Method</h1><span class="direct-upi-safe"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 1 22 5v8c0 7-4.6 11.7-10 14C6.6 24.7 2 20 2 13V5l10-4Z"/></svg><span>100% SAFE<br>PAYMENTS</span></span></div>
        <div class="direct-upi-online">PAY ONLINE</div>
        <div class="direct-upi-upi-title"><span class="direct-upi-upi-chip">UPI</span><span>PhonePe or scan Paytm QR</span></div>
        <div class="direct-upi-methods"></div>
        <button class="direct-upi-qr" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3V3Zm2 2v3h3V5H5Zm9-2h7v7h-7V3Zm2 2v3h3V5h-3ZM3 14h7v7H3v-7Zm2 2v3h3v-3H5Zm9-2h3v3h-3v-3Zm4 0h3v7h-3v-7Zm-4 4h3v3h-3v-3Z"/></svg><span>Scan Paytm QR to Pay</span><span>›</span></button>
        <div class="direct-upi-status" role="alert" hidden><span class="direct-upi-status-icon">!</span><span class="direct-upi-status-text"><strong class="direct-upi-status-title"></strong><p class="direct-upi-status-copy"></p><button class="direct-upi-retry" type="button">Try Again</button></span></div>
        <section class="direct-upi-price-card">
          <div class="direct-upi-price-row"><span>Total Product Price:</span><strong class="direct-upi-amount">₹—</strong></div>
          <div class="direct-upi-price-row"><span>Shipping:</span><strong class="direct-upi-free">FREE</strong></div>
          <div class="direct-upi-price-row total"><span>Order Total:</span><strong class="direct-upi-amount">₹—</strong></div>
        </section>
        <footer class="direct-upi-bottom"><span class="direct-upi-footer-price"><strong class="direct-upi-amount">₹—</strong><small>View price details</small></span><button class="direct-upi-pay" type="button"><span class="direct-upi-pay-copy">PayNow</span></button></footer>
      </div>`;
    page.appendChild(section);

    let selectedMethod = methods[0];
    const list = section.querySelector(".direct-upi-methods");
    const ui = {
      payButton: section.querySelector(".direct-upi-pay"),
      qrButton: section.querySelector(".direct-upi-qr"),
      status: section.querySelector(".direct-upi-status"),
      amountNodes: Array.from(section.querySelectorAll(".direct-upi-amount")),
      methods: [],
      paymentLaunched: false,
      appWasHidden: false,
      lastVerificationPayload: null,
    };

    const renderMethods = () => {
      list.innerHTML = "";
      methods.forEach((method) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `direct-upi-method${selectedMethod.id === method.id ? " selected" : ""}`;
        button.setAttribute("aria-pressed", selectedMethod.id === method.id ? "true" : "false");
        button.innerHTML = `<span class="direct-upi-radio"></span><span class="direct-upi-method-label">${method.label}</span><span class="direct-upi-method-logo logo-${method.id}"><img src="${method.logo}" alt="${method.label} logo"></span>`;
        button.addEventListener("click", () => {
          selectedMethod = method;
          ui.qrButton.classList.remove("is-selected");
          hideStatus(ui);
          renderMethods();
        });
        list.appendChild(button);
      });
      ui.methods = Array.from(list.querySelectorAll(".direct-upi-method"));
    };
    renderMethods();
    void loadDisplayAmount(ui);

    section.querySelector(".direct-upi-back").addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.assign("/cart");
    });
    ui.qrButton.addEventListener("click", () => {
      selectedMethod = { id: "qr", label: "Paytm QR", logo: "" };
      ui.qrButton.classList.add("is-selected");
      hideStatus(ui);
      renderMethods();
    });
    ui.payButton.addEventListener("click", () => startPayment(ui, selectedMethod));
    ui.status.querySelector(".direct-upi-retry").addEventListener("click", () => {
      startPayment(ui, selectedMethod);
    });
  }

  new MutationObserver(showUpiCheckout).observe(document.documentElement, { childList: true, subtree: true });
  showUpiCheckout();
})();
