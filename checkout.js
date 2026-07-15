const CHECKOUT_URL = "";

const checkoutButton = document.querySelector("#checkout-button");
const checkoutNote = document.querySelector("#checkout-note");

if (checkoutButton && CHECKOUT_URL) {
  checkoutButton.href = CHECKOUT_URL;
  checkoutButton.textContent = "Buy securely";
  checkoutButton.target = "_blank";
  checkoutButton.rel = "noreferrer";
  checkoutButton.removeAttribute("aria-disabled");

  if (checkoutNote) {
    checkoutNote.textContent = "Secure payment is handled by our checkout provider. Tiruvi never sees or stores card details.";
  }
}
