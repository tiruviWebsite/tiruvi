const CHECKOUT_STORAGE_KEY = "tiruviCheckout";

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

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  return response.json();
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

async function submitCheckout(event) {
  event.preventDefault();
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
    const tokenResult = await squareCard.tokenize();
    if (tokenResult.status !== "OK") {
      throw new Error(tokenResult.errors?.[0]?.message || "Card payment could not be tokenized.");
    }

    const response = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...collectFormData(event.currentTarget),
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
    setStatus(`Order received. Your order number is ${result.orderId}.`);
    button.textContent = "Order Received";
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
    const response = await fetch("/api/checkout-config");
    const config = await readJsonResponse(response, "Checkout service is not running here. Open the site through python3 main.py, not the static localhost:4173 server, to enable Square checkout.");
    await initializeSquare(config.square);
  } catch (error) {
    document.querySelector("#pay-button").disabled = true;
    document.querySelector("#square-status").textContent = error.message;
    setStatus(error.message, true);
  }
}

initCheckout();
