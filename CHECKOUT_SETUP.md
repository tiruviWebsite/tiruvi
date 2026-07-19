# Checkout Setup

The checkout flow uses Square for card payment and SMTP for order/shipping emails. Keep these values in environment variables; do not put secrets in browser JavaScript.

The Pay button only works when the site is opened from `python3 main.py`, because the checkout page needs `/api/checkout-config` and `/api/create-order`. A static server such as `localhost:4173` can show the page, but it cannot process Square payments.

For local Square testing, open `http://localhost:8000/checkout.html`. Do not use `http://127.0.0.1:8000/checkout.html`, because Square's Web Payments SDK expects HTTPS or a secure localhost context.

## Square

Set these before starting `main.py`:

```sh
export SQUARE_ENVIRONMENT=sandbox
export SQUARE_APPLICATION_ID="sandbox-sq0idb-..."
export SQUARE_LOCATION_ID="L..."
export SQUARE_ACCESS_TOKEN="EAAA..."
export SQUARE_VERSION="2026-07-15"
python3 main.py
```

Use `SQUARE_ENVIRONMENT=production` with production credentials when going live. The Application ID and Location ID are used by the browser payment form. The Access Token is used only by `main.py` to create the payment with Square.

If local Python cannot verify Square's HTTPS certificate, install/update the CA bundle with `python3 -m pip install --upgrade certifi`. The server uses `certifi` automatically when it is available.

## Cloudflare Worker Deployment

The deployed GitHub Pages site calls:

```txt
https://tiruvi-checkout.satwikgattu.workers.dev
```

The Worker source is in `workers/checkout`.

Deploy with Wrangler:

```sh
cd workers/checkout
npx wrangler deploy
```

Or deploy from the Cloudflare dashboard:

1. Open `tiruvi-checkout` in Workers & Pages.
2. Open the Worker editor.
3. Replace the default Hello World code with `workers/checkout/worker.js`.
4. Save and deploy.
5. Go to Settings, then Variables and Secrets.

Set secrets in Cloudflare before live checkout:

```sh
npx wrangler secret put SQUARE_APPLICATION_ID
npx wrangler secret put SQUARE_LOCATION_ID
npx wrangler secret put SQUARE_ACCESS_TOKEN
```

For sandbox testing, keep `SQUARE_ENVIRONMENT=sandbox` in `wrangler.toml` and use sandbox credentials. For live payments, change `SQUARE_ENVIRONMENT` to `production`, deploy again, and set the production Square credentials as Worker secrets.

In the Cloudflare dashboard, add these variables/secrets:

```txt
SQUARE_ENVIRONMENT=production
SQUARE_APPLICATION_ID=...
SQUARE_LOCATION_ID=...
SQUARE_ACCESS_TOKEN=...
SQUARE_VERSION=2026-07-15
ALLOWED_ORIGINS=https://www.tiruvi.co.uk,https://tiruvi.co.uk,http://localhost:8000
```

`SQUARE_ACCESS_TOKEN` must be a secret. The other values can also be stored as secrets for simplicity.

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
