const CURRENCY = "GBP";
const DEFAULT_SQUARE_VERSION = "2026-07-15";

const PRODUCTS = {
  sipping_cup: { key: "sipping_cup", title: "Training Cup", price: 10.95 },
  plate: { key: "plate", title: "Divided Plate", price: 15 },
  bowl: { key: "bowl", title: "Suction Bowl", price: 15 },
  spoon_set: { key: "spoon_set", title: "Baby Spoon", price: 20 },
  combo_all: { key: "combo_all", title: "Tiruvi Weaning Set", price: 45 },
};

const SHIPPING_OPTIONS = {
  free_delivery: { key: "free_delivery", title: "Free Delivery", price: 0, freeThreshold: 45 },
  shipping: { key: "shipping", title: "Standard Delivery", price: 4.99, freeThreshold: null },
  next_day_delivery: { key: "next_day_delivery", title: "Next-Day Delivery", price: 10.95, freeThreshold: null },
};

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function moneyToMinorUnits(value) {
  return Math.round(Number(value) * 100);
}

function calculateOrder(items, shippingKey) {
  const normalizedItems = [];
  let subtotal = 0;

  for (const item of items || []) {
    const key = normalizeKey(item.key);
    const product = PRODUCTS[key];
    if (!product) {
      throw new Error(`Unknown product: ${key}`);
    }

    const quantity = Number.parseInt(item.quantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Quantity must be between 1 and 20.");
    }

    const lineTotal = product.price * quantity;
    subtotal += lineTotal;
    normalizedItems.push({ ...product, quantity, lineTotal: Number(lineTotal.toFixed(2)) });
  }

  const availableShipping = Object.values(SHIPPING_OPTIONS).filter(
    (option) => option.freeThreshold === null || subtotal > option.freeThreshold,
  );
  const selectedShipping =
    availableShipping.find((option) => option.key === normalizeKey(shippingKey)) ||
    availableShipping.find((option) => option.price === 0) ||
    availableShipping.sort((a, b) => a.price - b.price)[0] ||
    { key: "", title: "Delivery", price: 0, freeThreshold: null };

  const total = subtotal + selectedShipping.price;
  return {
    items: normalizedItems,
    shipping: selectedShipping,
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

function squareConfig(env) {
  const environment = (env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
  return {
    environment,
    applicationId: env.SQUARE_APPLICATION_ID || "",
    locationId: env.SQUARE_LOCATION_ID || "",
    enabled: Boolean(env.SQUARE_APPLICATION_ID && env.SQUARE_LOCATION_ID && env.SQUARE_ACCESS_TOKEN),
  };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configuredOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!origin) {
    return "*";
  }
  if (!configuredOrigins.length || configuredOrigins.includes(origin)) {
    return origin;
  }
  return configuredOrigins[0] || origin;
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request, env),
    },
  });
}

function validateCheckoutPayload(payload) {
  const contact = payload.contact || {};
  const address = payload.deliveryAddress || {};
  if (!contact.email || !contact.phone || !contact.name) {
    throw new Error("Email, phone number, and full name are required.");
  }
  if (!address.line1 || !address.city || !address.postcode || !address.country) {
    throw new Error("Delivery address is required.");
  }
  if (!payload.sourceId) {
    throw new Error("Square payment token is missing.");
  }
}

async function createSquarePayment(env, sourceId, order) {
  const config = squareConfig(env);
  if (!config.enabled) {
    throw new Error("Square is not configured.");
  }

  const endpoint =
    config.environment === "production"
      ? "https://connect.squareup.com/v2/payments"
      : "https://connect.squareupsandbox.com/v2/payments";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Square-Version": env.SQUARE_VERSION || DEFAULT_SQUARE_VERSION,
    },
    body: JSON.stringify({
      source_id: sourceId,
      idempotency_key: crypto.randomUUID(),
      amount_money: {
        amount: moneyToMinorUnits(order.total),
        currency: CURRENCY,
      },
      location_id: config.locationId,
      autocomplete: true,
      note: `Tiruvi order ${order.id}`,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result.errors?.map((error) => error.detail || error.code).join(" ") || "Square payment failed.";
    throw new Error(detail);
  }
  return result;
}

async function handleCreateOrder(request, env) {
  const payload = await request.json();
  validateCheckoutPayload(payload);

  const totals = calculateOrder(payload.items, payload.shippingKey);
  const order = {
    id: `TIRUVI-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    status: "payment_pending",
    contact: payload.contact,
    deliveryAddress: payload.deliveryAddress,
    ...totals,
  };

  const paymentResult = await createSquarePayment(env, payload.sourceId, order);
  order.status = "order_received";

  return {
    orderId: order.id,
    status: order.status,
    paymentId: paymentResult.payment?.id || "",
    emailSent: [],
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/checkout-config") {
        return jsonResponse(request, env, {
          square: squareConfig(env),
          smtpEnabled: false,
          currency: CURRENCY,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/create-order") {
        const result = await handleCreateOrder(request, env);
        return jsonResponse(request, env, result);
      }

      return jsonResponse(request, env, { error: "Not found" }, 404);
    } catch (error) {
      return jsonResponse(request, env, { error: error.message || "Checkout failed." }, 400);
    }
  },
};
