#!/usr/bin/env python3
from __future__ import annotations

import argparse
import mimetypes
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


class SpaRequestHandler(SimpleHTTPRequestHandler):
    index_file = "index.html"

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        base = Path(self.directory).resolve()
        path = unquote(urlsplit(path).path)
        if path.endswith("/"):
            path += self.index_file
        candidate = (base / path.lstrip("/")).resolve()
        if base not in candidate.parents and candidate != base:
            return str(base / self.index_file)
        return str(candidate)

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / self.index_file
        if not path.exists():
            path = Path(self.directory) / self.index_file
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        try:
            file = path.open("rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-type", content_type)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.end_headers()
        return file

    def do_GET(self) -> None:
        result = self.send_head()
        if result is None:
            return
        with result:
            self.copyfile(result, self.wfile)

    def do_HEAD(self) -> None:
        result = self.send_head()
        if result is not None:
            result.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve a static SPA with index.html fallback.")
    parser.add_argument("directory", nargs="?", default=".", help="Directory to serve")
    parser.add_argument("--bind", default="127.0.0.1", help="Bind address")
    parser.add_argument("--port", type=int, default=3000, help="Port to listen on")
    args = parser.parse_args()

    handler = partial(SpaRequestHandler, directory=str(Path(args.directory).resolve()))
    httpd = ThreadingHTTPServer((args.bind, args.port), handler)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
