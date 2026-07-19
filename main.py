from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request, error
import csv
import json
import os
import smtplib
import ssl
import uuid

try:
    import certifi
except ImportError:
    certifi = None


HOST = "localhost"
START_PORT = 8000
ROOT = Path(__file__).resolve().parent
PRODUCT_SOURCE = ROOT / "assets" / "display_products_cost.csv"
ORDERS = {}


def parse_products():
    with PRODUCT_SOURCE.open(newline="", encoding="utf-8-sig") as product_file:
        return [{key.strip().lower(): value.strip() for key, value in row.items()} for row in csv.DictReader(product_file)]


def normalize_key(value):
    return "_".join("".join(char.lower() if char.isalnum() else " " for char in value).split())


def active_products_and_shipping():
    products = {}
    shipping = {}
    for row in parse_products():
        if row.get("status", "").lower() != "active":
            continue

        row_type = row.get("type", "Product").lower()
        key = normalize_key(row.get("product", ""))
        if row_type == "product":
            try:
                price = float(row.get("cost", ""))
            except ValueError:
                continue
            display_name = row.get("display name") or " ".join(part.capitalize() for part in key.split("_"))
            if key == "combo_all":
                display_name = "Tiruvi Weaning Set"
            products[key] = {"key": key, "title": display_name, "price": price}
        elif row_type == "shipping":
            cost = row.get("cost", "")
            threshold = None
            price = 0.0
            if cost.startswith(">"):
                try:
                    threshold = float(cost.replace(">", "").strip())
                except ValueError:
                    threshold = None
            else:
                try:
                    price = float(cost)
                except ValueError:
                    continue

            title = "Standard Delivery" if key == "shipping" else " ".join(part.capitalize() for part in key.split("_"))
            shipping[key] = {"key": key, "title": title, "price": price, "free_threshold": threshold}
    return products, shipping


def money_to_minor_units(value):
    return int(round(float(value) * 100))


def calculate_order(items, shipping_key):
    products, shipping_options = active_products_and_shipping()
    normalized_items = []
    subtotal = 0.0

    for item in items:
        key = normalize_key(str(item.get("key", "")))
        if key not in products:
            raise ValueError(f"Unknown product: {key}")
        quantity = int(item.get("quantity", 0))
        if quantity < 1 or quantity > 20:
            raise ValueError("Quantity must be between 1 and 20.")
        product = products[key]
        line_total = product["price"] * quantity
        subtotal += line_total
        normalized_items.append({**product, "quantity": quantity, "line_total": line_total})

    available_shipping = {
        key: option
        for key, option in shipping_options.items()
        if option["free_threshold"] is None or subtotal > option["free_threshold"]
    }
    if not available_shipping:
        selected_shipping = {"key": "", "title": "Delivery", "price": 0.0, "free_threshold": None}
    else:
        selected_shipping = available_shipping.get(shipping_key)
        if not selected_shipping:
            free_options = [option for option in available_shipping.values() if option["price"] == 0]
            selected_shipping = free_options[0] if free_options else min(available_shipping.values(), key=lambda option: option["price"])

    total = subtotal + selected_shipping["price"]
    return {
        "items": normalized_items,
        "shipping": selected_shipping,
        "subtotal": round(subtotal, 2),
        "total": round(total, 2),
    }


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def square_config():
    environment = os.getenv("SQUARE_ENVIRONMENT", "sandbox").lower()
    return {
        "environment": environment,
        "applicationId": os.getenv("SQUARE_APPLICATION_ID", ""),
        "locationId": os.getenv("SQUARE_LOCATION_ID", ""),
        "enabled": bool(os.getenv("SQUARE_APPLICATION_ID") and os.getenv("SQUARE_LOCATION_ID") and os.getenv("SQUARE_ACCESS_TOKEN")),
    }


def create_square_payment(source_id, order):
    config = square_config()
    if not config["enabled"]:
        raise RuntimeError("Square is not configured.")

    endpoint = "https://connect.squareupsandbox.com/v2/payments"
    if config["environment"] == "production":
        endpoint = "https://connect.squareup.com/v2/payments"

    body = {
        "source_id": source_id,
        "idempotency_key": str(uuid.uuid4()),
        "amount_money": {"amount": money_to_minor_units(order["total"]), "currency": "GBP"},
        "location_id": config["locationId"],
        "autocomplete": True,
        "note": f"Tiruvi order {order['id']}",
    }
    req = request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {os.getenv('SQUARE_ACCESS_TOKEN')}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Square-Version": os.getenv("SQUARE_VERSION", "2026-07-15"),
        },
        method="POST",
    )
    try:
        context = ssl.create_default_context(cafile=certifi.where()) if certifi else ssl.create_default_context()
        with request.urlopen(req, timeout=20, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"Square payment failed: {detail}") from exc


def email_configured():
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD") and os.getenv("ORDER_NOTIFY_EMAIL"))


def send_email(to_address, subject, body):
    if not email_configured() or not to_address:
        return False

    message = EmailMessage()
    message["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER"))
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls(context=context)
        smtp.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"))
        smtp.send_message(message)
    return True


def format_order_email(order):
    contact = order["contact"]
    address = order["deliveryAddress"]
    lines = [
        f"Order: {order['id']}",
        f"Status: {order['status']}",
        "",
        "Customer",
        f"Name: {contact.get('name')}",
        f"Email: {contact.get('email')}",
        f"Phone: {contact.get('phone')}",
        "",
        "Delivery address",
        address.get("line1", ""),
        address.get("line2", ""),
        f"{address.get('city', '')} {address.get('postcode', '')}".strip(),
        address.get("country", ""),
        "",
        "Items",
    ]
    for item in order["items"]:
        lines.append(f"- {item['quantity']} x {item['title']} ({item['line_total']:.2f} GBP)")
    lines.extend(
        [
            "",
            f"Delivery: {order['shipping']['title']} ({order['shipping']['price']:.2f} GBP)",
            f"Subtotal: {order['subtotal']:.2f} GBP",
            f"Total: {order['total']:.2f} GBP",
        ]
    )
    return "\n".join(line for line in lines if line is not None)


def notify_order_received(order):
    body = format_order_email(order)
    sent = []
    if send_email(os.getenv("ORDER_NOTIFY_EMAIL"), f"New Tiruvi order {order['id']}", body):
        sent.append("store")
    if send_email(order["contact"].get("email"), f"Tiruvi order received {order['id']}", body):
        sent.append("customer")
    return sent


class TiruviHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/checkout-config":
            json_response(self, 200, {"square": square_config(), "smtpEnabled": email_configured(), "currency": "GBP"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/create-order":
            self.handle_create_order()
            return
        if self.path == "/api/shipping-update":
            self.handle_shipping_update()
            return
        json_response(self, 404, {"error": "Not found"})

    def handle_create_order(self):
        try:
            payload = read_json(self)
            contact = payload.get("contact", {})
            address = payload.get("deliveryAddress", {})
            source_id = payload.get("sourceId")
            if not contact.get("email") or not contact.get("phone") or not address.get("line1") or not address.get("city") or not address.get("postcode"):
                raise ValueError("Email, phone number, and delivery address are required.")

            order_id = f"TIRUVI-{uuid.uuid4().hex[:8].upper()}"
            totals = calculate_order(payload.get("items", []), payload.get("shippingKey", ""))
            order = {
                "id": order_id,
                "status": "payment_pending",
                "contact": contact,
                "deliveryAddress": address,
                **totals,
            }

            payment_result = create_square_payment(source_id, order)
            order["status"] = "order_received"
            order["payment"] = payment_result.get("payment", {})
            ORDERS[order_id] = order
            email_sent = notify_order_received(order)
            json_response(self, 200, {"orderId": order_id, "status": order["status"], "emailSent": email_sent})
        except Exception as exc:
            json_response(self, 400, {"error": str(exc)})

    def handle_shipping_update(self):
        try:
            payload = read_json(self)
            order_id = payload.get("orderId")
            message = payload.get("message", "Your Tiruvi order shipping status has been updated.")
            order = ORDERS.get(order_id)
            if not order:
                raise ValueError("Order not found in this server session.")
            order["status"] = "shipping_update"
            sent = send_email(order["contact"].get("email"), f"Tiruvi shipping update {order_id}", message)
            json_response(self, 200, {"orderId": order_id, "emailSent": sent})
        except Exception as exc:
            json_response(self, 400, {"error": str(exc)})


def create_server():
    os.chdir(ROOT)
    for port in range(START_PORT, START_PORT + 20):
        try:
            return port, ThreadingHTTPServer((HOST, port), TiruviHandler)
        except OSError:
            continue
    raise RuntimeError("No available local port found.")


if __name__ == "__main__":
    port, server = create_server()
    print(f"Tiruvi site running at http://{HOST}:{port}/")
    server.serve_forever()
