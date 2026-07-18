const PRODUCT_SOURCE = "assets/display_products_cost.csv";
const PRODUCT_IMAGE_MANIFEST = "assets/product-images.json";
const CHECKOUT_STORAGE_KEY = "tiruviCheckout";

const PRODUCT_COPY = {
  combo_all: {
    title: "Tiruvi Weaning Set",
    description: "A complete mealtime set with plate, bowl, training cup, and baby spoon.",
    badge: "Best seller",
    reviews: 120,
    images: ["assets/tiruvi-weaning-set-hero.png"],
  },
  plate: {
    title: "Divided Plate",
    description: "Our divided plate is perfect for little portions and messy eats.",
    reviews: 82,
  },
  bowl: {
    title: "Suction Bowl",
    description: "A practical stainless steel bowl with a soft silicone exterior for steady everyday feeding.",
    reviews: 96,
  },
  sipping_cup: {
    title: "Training Cup",
    description: "A handled cup designed to help little hands practice confident independent drinking.",
    reviews: 118,
  },
  spoon_set: {
    title: "Baby Spoon",
    description: "A soft-grip baby spoon shaped for guided feeding and early self-feeding.",
    reviews: 64,
  },
};

const basket = new Map();
let products = [];
let shippingOptions = [];
let activeProduct = null;
let quantity = 1;
let lastFocusedElement = null;
let selectedShippingKey = "";
let userSelectedShipping = false;
let confirmationTimeout = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (const char of text.replace(/^\uFEFF/, "")) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (cell || row.length) {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
      }
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) =>
    headers.reduce((item, header, index) => {
      item[header.trim().toLowerCase()] = record[index] || "";
      return item;
    }, {}),
  );
}

function normalizeKey(product) {
  return product.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatFallbackTitle(product) {
  return product.replace(/[_+-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isActive(row) {
  return row.status.toLowerCase() === "active";
}

function isProductRow(row) {
  return (row.type || "Product").toLowerCase() === "product";
}

function isShippingRow(row) {
  return (row.type || "").toLowerCase() === "shipping";
}

function formatPrice(cost) {
  const amount = Number(cost);
  if (!Number.isFinite(amount)) {
    return cost;
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function formatBasketPrice(cost) {
  const amount = Number(cost);
  if (!Number.isFinite(amount)) {
    return cost;
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

async function loadManifest() {
  try {
    const response = await fetch(PRODUCT_IMAGE_MANIFEST);
    return response.ok ? response.json() : {};
  } catch {
    return {};
  }
}

function withDisplayData(product, manifest) {
  const key = normalizeKey(product.product);
  const copy = PRODUCT_COPY[key] || {};
  return {
    ...product,
    key,
    title: product["display name"] || copy.title || formatFallbackTitle(product.product),
    description: copy.description || "Beautifully designed for practical everyday weaning.",
    badge: copy.badge || "",
    reviews: copy.reviews || 88,
    price: Number(product.cost) || 0,
    images: copy.images || manifest[key] || ["assets/tiruvi-weaning-set-hero.png"],
  };
}

function withShippingData(row) {
  const cost = Number(row.cost);
  const thresholdMatch = row.cost.match(/>\s*(\d+(?:\.\d+)?)/);
  const key = normalizeKey(row.product);
  return {
    key,
    title: key === "shipping" ? "Standard Delivery" : formatFallbackTitle(row.product),
    price: Number.isFinite(cost) ? cost : 0,
    freeThreshold: thresholdMatch ? Number(thresholdMatch[1]) : null,
  };
}

function getShippingDescription(option) {
  if (option.key === "free_delivery") {
    return "3-5 working days";
  }
  if (option.key === "shipping") {
    return "2-3 working days";
  }
  if (option.key === "next_day_delivery") {
    return "Order by 1pm";
  }
  return "";
}

function truckIcon() {
  return `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 6h11v10H3z"></path>
      <path d="M14 10h4l3 3v3h-7z"></path>
      <circle cx="7" cy="18" r="2"></circle>
      <circle cx="17" cy="18" r="2"></circle>
    </svg>
  `;
}

function createProductCard(product, compact = false) {
  const card = document.createElement("article");
  const primaryImage = product.images[0];
  const alternateImage = product.images[1] || primaryImage;
  card.className = "product-card";
  card.innerHTML = `
    <button class="wishlist" type="button" aria-label="Save ${product.title}">♡</button>
    <a class="product-card-media" href="products.html#product-detail" aria-label="View ${product.title}" data-product-key="${product.key}">
      <img class="primary-image" src="${primaryImage}" alt="${product.title}" loading="lazy">
      <img class="alternate-image" src="${alternateImage}" alt="" aria-hidden="true" loading="lazy">
    </a>
    <div class="product-card-body">
      <h3>${product.title}</h3>
      <strong>${formatPrice(product.price)}</strong>
      <div class="stars" aria-label="Rated five stars">★★★★★ <span>(${product.reviews})</span></div>
      ${compact ? '<a class="card-action" href="products.html#product-detail">View product</a>' : ""}
    </div>
  `;

  card.querySelector("[data-product-key]")?.addEventListener("click", () => {
    setActiveProduct(product.key);
  });

  card.querySelector(".card-action")?.addEventListener("click", () => {
    setActiveProduct(product.key);
  });

  return card;
}

function renderGrid(selector, list, options = {}) {
  const grid = document.querySelector(selector);
  if (!grid) {
    return;
  }

  const cards = list.map((product) => createProductCard(product, options.compact));
  grid.replaceChildren(...cards);
}

function setActiveProduct(key) {
  activeProduct = products.find((product) => product.key === key) || products[0];
  quantity = 1;
  renderDetail();
}

function renderDetail() {
  if (!activeProduct || !document.querySelector("#product-detail")) {
    return;
  }

  const title = document.querySelector("#detail-title");
  const price = document.querySelector("#detail-price");
  const reviews = document.querySelector("#detail-reviews");
  const description = document.querySelector("#detail-description");
  const image = document.querySelector("#detail-image");
  const thumbnails = document.querySelector("#detail-thumbnails");
  const quantityInput = document.querySelector("#quantity");

  title.textContent = activeProduct.title;
  price.textContent = formatPrice(activeProduct.price);
  reviews.textContent = `(${activeProduct.reviews} reviews)`;
  description.textContent = activeProduct.description;
  image.src = activeProduct.images[0];
  image.alt = activeProduct.title;
  quantityInput.value = String(quantity);

  const thumbButtons = activeProduct.images.map((src) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<img src="${src}" alt="">`;
    button.addEventListener("click", () => {
      image.src = src;
    });
    return button;
  });

  thumbnails.replaceChildren(...thumbButtons);
}

function addToBasket(product, count) {
  const current = basket.get(product.key) || { product, count: 0 };
  current.count += count;
  basket.set(product.key, current);
  renderBasket();
}

function showBasketConfirmation(product, count) {
  const confirmation = document.querySelector("#basket-confirmation");
  const button = document.querySelector("#add-to-basket");
  if (!confirmation || !button) {
    return;
  }

  window.clearTimeout(confirmationTimeout);
  confirmation.textContent = `${count} ${product.title} ${count === 1 ? "has" : "have"} been added to your basket.`;
  confirmation.classList.add("is-visible");
  button.textContent = "Added to Basket";
  button.classList.add("is-confirmed");

  confirmationTimeout = window.setTimeout(() => {
    confirmation.classList.remove("is-visible");
    confirmation.textContent = "";
    button.textContent = "Add to Basket";
    button.classList.remove("is-confirmed");
  }, 3200);
}

function removeFromBasket(key) {
  basket.delete(key);
  renderBasket();
}

function updateBasketQuantity(key, nextCount) {
  const item = basket.get(key);
  if (!item) {
    return;
  }

  if (nextCount <= 0) {
    basket.delete(key);
  } else {
    item.count = Math.min(20, nextCount);
    basket.set(key, item);
  }

  renderBasket();
}

function showBasketScreen() {
  document.querySelector("#basket-screen")?.classList.add("is-active");
}

function openBasketModal() {
  const modal = document.querySelector("#basket-modal");
  if (!modal) {
    return;
  }

  lastFocusedElement = document.activeElement;
  showBasketScreen();
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close")?.focus();
}

function closeBasketModal() {
  const modal = document.querySelector("#basket-modal");
  if (!modal) {
    return;
  }

  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

function getBasketEntries() {
  return [...basket.values()];
}

function getBasketSubtotal(entries = getBasketEntries()) {
  return entries.reduce((sum, item) => sum + item.product.price * item.count, 0);
}

function getAvailableShippingOptions(subtotal) {
  return shippingOptions.filter((option) => option.freeThreshold === null || subtotal > option.freeThreshold);
}

function getSelectedShipping(subtotal) {
  const available = getAvailableShippingOptions(subtotal);
  if (!available.length) {
    return null;
  }

  const selected = available.find((option) => option.key === selectedShippingKey);
  const freeOption = available.find((option) => option.price === 0);
  if (selected && (userSelectedShipping || !freeOption)) {
    return selected;
  }

  const defaultOption = freeOption || available.reduce((lowest, option) => (option.price < lowest.price ? option : lowest), available[0]);
  selectedShippingKey = defaultOption.key;
  return defaultOption;
}

function renderShippingOptions(subtotal) {
  const container = document.querySelector("#shipping-options");
  if (!container) {
    return;
  }

  if (!shippingOptions.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const selectedShipping = getSelectedShipping(subtotal);
  const options = shippingOptions.map((option) => {
    const locked = option.freeThreshold !== null && subtotal <= option.freeThreshold;
    const label = document.createElement("label");
    label.className = "shipping-option";
    label.innerHTML = `
      <span class="shipping-icon">${truckIcon()}</span>
      <span>
        <strong>${option.title}</strong>
        <small>${getShippingDescription(option)}${locked ? ` · Orders over ${formatPrice(option.freeThreshold)}` : ""}</small>
      </span>
      <span>${formatBasketPrice(option.price)}</span>
      <input type="radio" name="shipping" value="${option.key}" ${selectedShipping?.key === option.key ? "checked" : ""} ${locked ? "disabled" : ""}>
    `;
    label.querySelector("input").addEventListener("change", () => {
      selectedShippingKey = option.key;
      userSelectedShipping = true;
      renderBasket();
    });
    return label;
  });

  const legend = document.createElement("legend");
  legend.textContent = "Delivery";
  container.replaceChildren(legend, ...options);
}

function renderBasket() {
  const basketItems = document.querySelector("#basket-items");
  const subtotalEl = document.querySelector("#basket-subtotal");
  const shippingEl = document.querySelector("#basket-shipping");
  const totalEl = document.querySelector("#basket-total");
  const itemCountEl = document.querySelector("#basket-item-count");
  const countEls = document.querySelectorAll("#cart-count, .cart-link span");
  if (!basketItems) {
    return;
  }

  const entries = getBasketEntries();
  const itemCount = entries.reduce((sum, item) => sum + item.count, 0);
  const subtotal = getBasketSubtotal(entries);
  const selectedShipping = getSelectedShipping(subtotal);
  const shippingTotal = entries.length && selectedShipping ? selectedShipping.price : 0;

  countEls.forEach((el) => {
    el.textContent = String(itemCount);
  });
  if (itemCountEl) {
    itemCountEl.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  }
  if (!entries.length) {
    userSelectedShipping = false;
    subtotalEl.textContent = formatBasketPrice(0);
    shippingEl.textContent = formatBasketPrice(0);
    totalEl.textContent = formatBasketPrice(0);
    const shippingContainer = document.querySelector("#shipping-options");
    if (shippingContainer) {
      shippingContainer.hidden = true;
    }
    basketItems.innerHTML = '<p class="empty-basket">Your basket is ready for weaning essentials.</p>';
    return;
  }

  subtotalEl.textContent = formatBasketPrice(subtotal);
  shippingEl.textContent = formatBasketPrice(shippingTotal);
  totalEl.textContent = formatBasketPrice(subtotal + shippingTotal);
  renderShippingOptions(subtotal);

  const rows = entries.map(({ product, count }) => {
    const row = document.createElement("article");
    row.className = "basket-row";
    row.innerHTML = `
      <img src="${product.images[0]}" alt="">
      <div>
        <strong>${product.title}</strong>
        <small>Sage</small>
        <span class="basket-stepper">
          <button type="button" aria-label="Decrease ${product.title}">−</button>
          <input value="${count}" aria-label="${product.title} quantity" inputmode="numeric">
          <button type="button" aria-label="Increase ${product.title}">+</button>
        </span>
      </div>
      <span>${formatBasketPrice(product.price * count)}</span>
      <button class="remove-item" type="button" aria-label="Remove ${product.title}">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M4 7h16"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
          <path d="M6 7l1 14h10l1-14"></path>
          <path d="M9 7V4h6v3"></path>
        </svg>
      </button>
    `;
    const [decreaseButton, increaseButton, removeButton] = row.querySelectorAll("button");
    const countInput = row.querySelector("input");
    decreaseButton.addEventListener("click", () => updateBasketQuantity(product.key, count - 1));
    increaseButton.addEventListener("click", () => updateBasketQuantity(product.key, count + 1));
    countInput.addEventListener("input", (event) => {
      const nextCount = Number.parseInt(event.target.value, 10);
      updateBasketQuantity(product.key, Number.isFinite(nextCount) ? nextCount : 1);
    });
    removeButton.addEventListener("click", () => removeFromBasket(product.key));
    return row;
  });

  basketItems.replaceChildren(...rows);
}

function buildCheckoutPayload() {
  const entries = getBasketEntries();
  const subtotal = getBasketSubtotal(entries);
  const selectedShipping = getSelectedShipping(subtotal);
  const shippingTotal = entries.length && selectedShipping ? selectedShipping.price : 0;
  return {
    items: entries.map(({ product, count }) => ({
      key: product.key,
      title: product.title,
      quantity: count,
      price: product.price,
      lineTotal: product.price * count,
      image: product.images[0],
    })),
    shipping: selectedShipping || { key: "", title: "Delivery", price: 0 },
    subtotal,
    total: subtotal + shippingTotal,
  };
}

function proceedToCheckout(event) {
  const payload = buildCheckoutPayload();
  if (!payload.items.length) {
    event.preventDefault();
    const basketItems = document.querySelector("#basket-items");
    basketItems.innerHTML = '<p class="empty-basket">Add an item before proceeding to checkout.</p>';
    return;
  }
  localStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(payload));
}

function bindControls() {
  document.querySelector("#qty-minus")?.addEventListener("click", () => {
    quantity = Math.max(1, quantity - 1);
    renderDetail();
  });

  document.querySelector("#qty-plus")?.addEventListener("click", () => {
    quantity = Math.min(20, quantity + 1);
    renderDetail();
  });

  document.querySelector("#quantity")?.addEventListener("input", (event) => {
    const value = Number.parseInt(event.target.value, 10);
    quantity = Number.isFinite(value) ? Math.min(20, Math.max(1, value)) : 1;
  });

  document.querySelector("#add-to-basket")?.addEventListener("click", () => {
    if (activeProduct) {
      addToBasket(activeProduct, quantity);
      showBasketConfirmation(activeProduct, quantity);
    }
  });

  document.querySelectorAll("[data-basket-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", (event) => {
      if (document.querySelector("#basket-modal")) {
        event.preventDefault();
        openBasketModal();
      }
    });
  });

  document.querySelectorAll("[data-basket-close]").forEach((control) => {
    control.addEventListener("click", closeBasketModal);
  });

  document.querySelector("#proceed-checkout")?.addEventListener("click", proceedToCheckout);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#basket-modal")?.hidden) {
      closeBasketModal();
    }
  });

}

async function initStorefront() {
  try {
    const [productsResponse, manifest] = await Promise.all([fetch(PRODUCT_SOURCE), loadManifest()]);
    if (!productsResponse.ok) {
      throw new Error(`Unable to load ${PRODUCT_SOURCE}`);
    }

    const rows = parseCsv(await productsResponse.text());
    products = rows
      .filter((product) => isActive(product) && isProductRow(product) && Number.isFinite(Number(product.cost)))
      .map((product) => withDisplayData(product, manifest));
    shippingOptions = rows
      .filter((row) => isActive(row) && isShippingRow(row))
      .map(withShippingData)
      .sort((first, second) => first.price - second.price);

    const individualProducts = products.filter((product) => product.key !== "combo_all");
    renderGrid("#home-products", products.slice(0, 5));
    renderGrid("#product-grid", products);

    const productCount = document.querySelector("#product-count");
    if (productCount) {
      productCount.textContent = `${products.length} products`;
    }

    setActiveProduct(individualProducts[0]?.key || products[0]?.key);
    renderBasket();
    bindControls();

    if (window.location.hash === "#basket-modal") {
      openBasketModal();
    }
  } catch {
    document.querySelectorAll("#home-products, #product-grid").forEach((grid) => {
      grid.innerHTML = '<p class="product-loading">Products are temporarily unavailable. Please message Tiruvi on Instagram to order.</p>';
    });
  }
}

initStorefront();
