const CHECKOUT_STORAGE_KEY = "tiruviCheckout";
const CHECKOUT_API_BASE = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? ""
  : "https://tiruvi-checkout.satwikgattu.workers.dev";

let checkoutPayload = null;
let squareCard = null;
let squareEnabled = false;

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function setStatus(message, isError = false) {
  const status = document.querySelector("#checkout-status");
  if (!status) {
    return;
  }
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function getDeliveryEstimate() {
  const title = checkoutPayload?.shipping?.title?.toLowerCase() || "";
  if (title.includes("next")) {
    return "Next Business Day";
  }
  if (title.includes("standard") || title.includes("2 day")) {
    return "2-3 Business Days";
  }
  if (title.includes("free")) {
    return "3-5 Business Days";
  }
  return "2-4 Business Days";
}

function showOrderSuccess(orderId, email) {
  const modal = document.querySelector("#order-success-modal");
  const orderNumber = document.querySelector("#order-success-id");
  const deliveryEstimate = document.querySelector("#order-success-delivery");
  const confirmationEmail = document.querySelector("#order-success-email");
  if (!modal || !orderNumber) {
    setStatus(`Order received. Your order number is ${orderId}.`);
    return;
  }

  orderNumber.textContent = orderId;
  if (deliveryEstimate) {
    deliveryEstimate.textContent = getDeliveryEstimate();
  }
  if (confirmationEmail) {
    confirmationEmail.textContent = email ? `Confirmation sent to ${email}.` : "A confirmation has been sent to your email.";
  }
  modal.hidden = false;
  document.body.classList.add("modal-open");
  const continueButton = modal.querySelector("a");
  continueButton?.focus();
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

function renderSummary() {
  const itemsContainer = document.querySelector("#checkout-items");
  if (!itemsContainer || !checkoutPayload) {
    return;
  }

  const rows = checkoutPayload.items.map((item) => {
    const row = document.createElement("article");
    row.className = "checkout-summary-row";
    row.innerHTML = `
      <img src="${item.image}" alt="">
      <div>
        <strong>${item.title}</strong>
        <small>Qty ${item.quantity}</small>
      </div>
      <span>${formatMoney(item.lineTotal)}</span>
    `;
    return row;
  });

  itemsContainer.replaceChildren(...rows);
  document.querySelector("#checkout-subtotal").textContent = formatMoney(checkoutPayload.subtotal);
  document.querySelector("#checkout-shipping").textContent = formatMoney(checkoutPayload.shipping.price);
  document.querySelector("#checkout-total").textContent = formatMoney(checkoutPayload.total);
  document.querySelector("#pay-button").textContent = `Pay ${formatMoney(checkoutPayload.total)}`;
}

function loadSquareScript(environment) {
  return new Promise((resolve, reject) => {
    if (window.Square) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = environment === "production" ? "https://web.squarecdn.com/v1/square.js" : "https://sandbox.web.squarecdn.com/v1/square.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Unable to load Square payment form."));
    document.head.appendChild(script);
  });
}

async function initializeSquare(square) {
  const squareStatus = document.querySelector("#square-status");
  const payButton = document.querySelector("#pay-button");
  if (!square.enabled) {
    squareEnabled = false;
    payButton.disabled = true;
    squareStatus.textContent = "Square is not connected yet. Add the Square Application ID, Location ID, and Access Token before taking payment.";
    return;
  }

  await loadSquareScript(square.environment);
  const payments = window.Square.payments(square.applicationId, square.locationId);
  squareCard = await payments.card();
  await squareCard.attach("#card-container");
  squareEnabled = true;
  squareStatus.textContent = "Card payment is secured by Square.";
  payButton.disabled = false;
}

function collectFormData(form) {
  const formData = new FormData(form);
  return {
    contact: {
      email: formData.get("email").trim(),
      phone: formData.get("phone").trim(),
      name: formData.get("name").trim(),
    },
    deliveryAddress: {
      line1: formData.get("line1").trim(),
      line2: formData.get("line2").trim(),
      city: formData.get("city").trim(),
      postcode: formData.get("postcode").trim(),
      country: formData.get("country"),
    },
  };
}

function countryCodeForSquare(country) {
  if (country === "United Kingdom") {
    return "GB";
  }
  return "GB";
}

function splitName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    givenName: parts[0] || "",
    familyName: parts.slice(1).join(" ") || parts[0] || "",
  };
}

function buildVerificationDetails(customerDetails) {
  const { givenName, familyName } = splitName(customerDetails.contact.name);
  const address = customerDetails.deliveryAddress;
  return {
    amount: checkoutPayload.total.toFixed(2),
    currencyCode: "GBP",
    intent: "CHARGE",
    customerInitiated: true,
    sellerKeyedIn: false,
    billingContact: {
      givenName,
      familyName,
      email: customerDetails.contact.email,
      phone: customerDetails.contact.phone,
      addressLines: [address.line1, address.line2].filter(Boolean),
      city: address.city,
      postalCode: address.postcode,
      countryCode: countryCodeForSquare(address.country),
    },
  };
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector("#pay-button");
  if (!checkoutPayload) {
    setStatus("Your basket is empty. Please return to the shop.", true);
    return;
  }
  if (!squareEnabled || !squareCard) {
    setStatus("Square is not connected yet, so payment cannot be taken.", true);
    return;
  }

  button.disabled = true;
  setStatus("Processing payment...");
  try {
    const customerDetails = collectFormData(form);
    const tokenResult = await squareCard.tokenize(buildVerificationDetails(customerDetails));
    if (tokenResult.status !== "OK") {
      throw new Error(tokenResult.errors?.[0]?.message || "Card payment could not be tokenized.");
    }

    const response = await fetch(`${CHECKOUT_API_BASE}/api/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...customerDetails,
        items: checkoutPayload.items.map((item) => ({ key: item.key, quantity: item.quantity })),
        shippingKey: checkoutPayload.shipping.key,
        sourceId: tokenResult.token,
      }),
    });
    const result = await readJsonResponse(response, "Checkout service is unavailable. Please try again after the checkout server is running.");
    if (result.error) {
      throw new Error(result.error || "Checkout failed.");
    }

    localStorage.removeItem(CHECKOUT_STORAGE_KEY);
    setStatus("");
    button.textContent = "Order Received";
    showOrderSuccess(result.orderId, customerDetails.contact.email);
  } catch (error) {
    setStatus(error.message, true);
    button.disabled = false;
  }
}

async function initCheckout() {
  const rawPayload = localStorage.getItem(CHECKOUT_STORAGE_KEY);
  checkoutPayload = rawPayload ? JSON.parse(rawPayload) : null;
  if (!checkoutPayload || !checkoutPayload.items?.length) {
    setStatus("Your basket is empty. Please return to the shop.", true);
    document.querySelector("#pay-button").disabled = true;
    return;
  }

  renderSummary();
  document.querySelector("#checkout-form").addEventListener("submit", submitCheckout);

  try {
    const response = await fetch(`${CHECKOUT_API_BASE}/api/checkout-config`);
    const config = await readJsonResponse(response, "Checkout service is not running here. Open the site through python3 main.py, not the static localhost:4173 server, to enable Square checkout.");
    await initializeSquare(config.square);
  } catch (error) {
    document.querySelector("#pay-button").disabled = true;
    document.querySelector("#square-status").textContent = error.message;
    setStatus(error.message, true);
  }
}

initCheckout();
