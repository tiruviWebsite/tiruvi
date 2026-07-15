const PRODUCT_SOURCE = "assets/display_products_cost.csv";
const PRODUCT_IMAGE_MANIFEST = "assets/product-images.json";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

const PRODUCT_OVERRIDES = {
  combo_all: {
    title: "Complete Weaning Set",
    badge: "Best value",
  },
};

const ORDER_SECTION_URL = "index.html#order";
let productImageManifest = {};

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

function normalizeProductKey(product) {
  return product.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatProductTitle(product) {
  return product
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isImageFile(path) {
  return IMAGE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));
}

async function getImagesFromFolder(folderPath) {
  try {
    const response = await fetch(folderPath);
    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const documentFragment = new DOMParser().parseFromString(html, "text/html");
    return [...documentFragment.querySelectorAll("a")]
      .map((link) => decodeURIComponent(link.getAttribute("href") || ""))
      .filter((href) => href && !href.startsWith("?") && !href.startsWith("/"))
      .filter(isImageFile)
      .map((href) => new URL(href, new URL(folderPath, window.location.href)).pathname.replace(/^\//, ""))
      .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
  } catch (error) {
    return [];
  }
}

async function loadProductImageManifest() {
  try {
    const response = await fetch(PRODUCT_IMAGE_MANIFEST);
    if (!response.ok) {
      return {};
    }

    return await response.json();
  } catch (error) {
    return {};
  }
}

async function getProductDetails(product) {
  const key = normalizeProductKey(product.product);
  const override = PRODUCT_OVERRIDES[key] || {};
  const folderImages = override.images || productImageManifest[key] || (await getImagesFromFolder(`assets/${key}/`));

  return {
    title: override.title || formatProductTitle(product.product),
    images: folderImages.length ? folderImages : ["assets/tiruvi-weaning-set-hero.png"],
    badge: override.badge,
  };
}

async function createProductCard(product) {
  const details = await getProductDetails(product);
  const primaryImage = details.images[0];
  const alternateImage = details.images[1] || primaryImage;
  const card = document.createElement("article");
  card.className = "product-card";
  card.innerHTML = `
    <a class="product-card-media" href="${ORDER_SECTION_URL}" aria-label="Order ${details.title}">
      <img class="product-image primary-image" src="${primaryImage}" alt="${details.title}" loading="lazy">
      <img class="product-image alternate-image" src="${alternateImage}" alt="" aria-hidden="true" loading="lazy">
      ${details.badge ? `<span class="product-badge">${details.badge}</span>` : ""}
      ${details.images.length > 1 ? `<span class="product-image-count">${details.images.length} photos</span>` : ""}
    </a>
    <div class="product-card-body">
      <h3>${details.title}</h3>
      <strong>${formatPrice(product.cost)}</strong>
    </div>
  `;

  return card;
}

async function renderProducts() {
  const productGrid = document.querySelector("#product-grid");
  const productCount = document.querySelector("#product-count");
  if (!productGrid) {
    return;
  }

  try {
    const response = await fetch(PRODUCT_SOURCE);
    if (!response.ok) {
      throw new Error(`Unable to load ${PRODUCT_SOURCE}`);
    }

    const products = parseCsv(await response.text()).filter(
      (product) => product.status.toLowerCase() === "active",
    );
    productImageManifest = await loadProductImageManifest();

    if (productCount) {
      productCount.textContent = `${products.length} Products:`;
    }

    const productCards = await Promise.all(products.map(createProductCard));
    productGrid.replaceChildren(...productCards);
  } catch (error) {
    productGrid.innerHTML = `
      <p class="product-loading">Products are temporarily unavailable. Please message Tiruvi on Instagram to order.</p>
    `;
  }
}

renderProducts();
