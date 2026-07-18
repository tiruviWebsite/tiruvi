# Checkout Setup

The checkout flow uses Square for card payment and SMTP for order/shipping emails. Keep these values in environment variables; do not put secrets in browser JavaScript.

The Pay button only works when the site is opened from `python3 main.py`, because the checkout page needs `/api/checkout-config` and `/api/create-order`. A static server such as `localhost:4173` can show the page, but it cannot process Square payments.

## Square

Set these before starting `main.py`:

```sh
export SQUARE_ENVIRONMENT=sandbox
export SQUARE_APPLICATION_ID="sandbox-sq0idb-..."
export SQUARE_LOCATION_ID="L..."
export SQUARE_ACCESS_TOKEN="EAAA..."
export SQUARE_VERSION="2026-06-18"
python3 main.py
```

Use `SQUARE_ENVIRONMENT=production` with production credentials when going live. The Application ID and Location ID are used by the browser payment form. The Access Token is used only by `main.py` to create the payment with Square.

## SMTP

Any SMTP provider that supports username/password over TLS can be used, including free-tier providers. Set:

```sh
export SMTP_HOST="smtp.example.com"
export SMTP_PORT="587"
export SMTP_USER="smtp-user"
export SMTP_PASSWORD="smtp-password"
export SMTP_FROM="orders@yourdomain.com"
export ORDER_NOTIFY_EMAIL="orders@yourdomain.com"
python3 main.py
```

When SMTP is configured, the server sends an order received email to `ORDER_NOTIFY_EMAIL` and to the customer email after Square payment succeeds. Shipping updates can be sent with:

```sh
curl -X POST http://127.0.0.1:8000/api/shipping-update \
  -H "Content-Type: application/json" \
  -d '{"orderId":"TIRUVI-12345678","message":"Your order has shipped."}'
```
