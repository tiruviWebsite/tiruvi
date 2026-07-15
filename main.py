from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
START_PORT = 8000


def create_server():
    for port in range(START_PORT, START_PORT + 20):
        try:
            return port, ThreadingHTTPServer((HOST, port), SimpleHTTPRequestHandler)
        except OSError:
            continue
    raise RuntimeError("No available local port found.")


if __name__ == "__main__":
    port, server = create_server()
    print(f"Tiruvi site running at http://{HOST}:{port}/")
    server.serve_forever()
