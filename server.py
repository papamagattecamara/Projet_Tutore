#!/usr/bin/env python3
"""Serveur local pour le lecteur TV Monde.

- Sert les fichiers statiques (index.html, app.js, style.css).
- Expose /proxy?url=...  pour contourner les restrictions CORS de certains flux
  HLS : les playlists .m3u8 sont réécrites pour que chaque segment passe aussi
  par le proxy.

Aucune dépendance : bibliothèque standard Python 3 uniquement.
Usage : python3 server.py [port]
"""

import http.server
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(_ARGS[0]) if _ARGS else 8000
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 15


def proxify(url, referrer="", ua=""):
    params = {"url": url}
    if referrer:
        params["ref"] = referrer
    if ua:
        params["ua"] = ua
    return "/proxy?" + urllib.parse.urlencode(params)


def rewrite_playlist(text, base_url, referrer, ua):
    """Réécrit toutes les URI d'une playlist HLS pour passer par le proxy."""
    out = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
        elif stripped.startswith("#"):
            # Attributs URI="..." (clés, sous-titres, pistes audio, etc.)
            if 'URI="' in stripped:
                start = stripped.index('URI="') + 5
                end = stripped.index('"', start)
                uri = urllib.parse.urljoin(base_url, stripped[start:end])
                stripped = stripped[:start] + proxify(uri, referrer, ua) + stripped[end:]
            out.append(stripped)
        else:
            out.append(proxify(urllib.parse.urljoin(base_url, stripped), referrer, ua))
    return "\n".join(out) + "\n"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if not self.path.startswith("/proxy"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/proxy"):
            self.handle_proxy()
        elif self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            super().do_GET()

    def handle_proxy(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = query.get("url", [""])[0]
        referrer = query.get("ref", [""])[0]
        ua = query.get("ua", [""])[0]
        if not url.startswith(("http://", "https://")):
            self.send_error(400, "URL invalide")
            return

        headers = {"User-Agent": ua or DEFAULT_UA}
        if referrer:
            headers["Referer"] = referrer
            parsed = urllib.parse.urlparse(referrer)
            headers["Origin"] = f"{parsed.scheme}://{parsed.netloc}"
        if "Range" in self.headers:
            headers["Range"] = self.headers["Range"]

        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=TIMEOUT
            ) as resp:
                final_url = resp.geturl()
                ctype = resp.headers.get("Content-Type", "application/octet-stream")
                is_playlist = (
                    "mpegurl" in ctype.lower()
                    or urllib.parse.urlparse(final_url).path.lower().endswith(".m3u8")
                )
                if is_playlist:
                    body = resp.read()
                    text = body.decode("utf-8", errors="replace")
                    if text.lstrip().startswith("#EXTM3U"):
                        body = rewrite_playlist(text, final_url, referrer, ua).encode()
                        ctype = "application/vnd.apple.mpegurl"
                    self.send_response(resp.status)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    self.wfile.write(body)
                    return

                self.send_response(resp.status)
                self.send_header("Content-Type", ctype)
                for h in ("Content-Length", "Content-Range", "Accept-Ranges"):
                    if resp.headers.get(h):
                        self.send_header(h, resp.headers[h])
                self.end_headers()
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as e:
            self.send_error(e.code, f"Erreur distante : {e.reason}")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # réseau, timeout, DNS...
            try:
                self.send_error(502, f"Flux injoignable : {e}")
            except Exception:
                pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"TV Monde est lancé sur {url}  (Ctrl+C pour arrêter)")
        if "--no-browser" not in sys.argv:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt.")
