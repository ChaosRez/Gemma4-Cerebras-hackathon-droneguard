from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from droneguard_multiverse.cache.replay import CacheMissError
from droneguard_multiverse.observability.trace_store import TraceStore
from droneguard_multiverse.orchestration.run import RunOrchestrator
from droneguard_multiverse.paths import DATA_DIR, TRACE_DIR, WEB_DIR


class DroneGuardHandler(BaseHTTPRequestHandler):
    orchestrator = RunOrchestrator()
    recent_runs: dict[str, dict[str, Any]] = {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/api/scenarios":
                self._json({"scenarios": self.orchestrator.list_scenarios()})
            elif path.startswith("/api/scenarios/"):
                scenario_id = unquote(path.removeprefix("/api/scenarios/"))
                self._json(self.orchestrator.get_scenario_detail(scenario_id))
            elif path.startswith("/api/runs/") and path.endswith("/events"):
                run_id = unquote(path.removeprefix("/api/runs/").removesuffix("/events").strip("/"))
                events = self.recent_runs.get(run_id, {}).get("trace_events") or TraceStore.read_run(run_id, TRACE_DIR)
                self._json({"run_id": run_id, "events": events})
            elif path.startswith("/api/cache/"):
                cache_key = unquote(path.removeprefix("/api/cache/"))
                self._json(self.orchestrator.cache.load_by_key(cache_key))
            elif path.startswith("/samples/"):
                self._serve_file(DATA_DIR / unquote(path.removeprefix("/samples/")))
            else:
                self._serve_web(path)
        except (ValueError, FileNotFoundError, CacheMissError) as exc:
            self._json({"error": str(exc)}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path != "/api/runs":
            self._json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return
        try:
            payload = self._read_json()
            result = self.orchestrator.run_scenario(
                str(payload.get("scenario_id", "")),
                str(payload.get("mode", "replay")),
            )
            self.recent_runs[result["run_id"]] = result
            self._json(result)
        except (ValueError, FileNotFoundError, json.JSONDecodeError) as exc:
            self._json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        if not body:
            return {}
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError("request body must be a JSON object")
        return payload

    def _json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _serve_web(self, path: str) -> None:
        file_path = WEB_DIR / "index.html" if path == "/" else WEB_DIR / unquote(path.lstrip("/"))
        self._serve_file(file_path)

    def _serve_file(self, file_path: Path) -> None:
        resolved = file_path.resolve()
        allowed_roots = (WEB_DIR.resolve(), DATA_DIR.resolve())
        if not any(resolved == root or root in resolved.parents for root in allowed_roots):
            self._json({"error": "path is outside served roots"}, status=HTTPStatus.FORBIDDEN)
            return
        if not resolved.exists() or not resolved.is_file():
            self._json({"error": "file not found"}, status=HTTPStatus.NOT_FOUND)
            return
        content = resolved.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", _content_type(resolved))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
    }.get(suffix, "application/octet-stream")


def run_dev_server(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), DroneGuardHandler)
    print(f"DroneGuard Multiverse running at http://{host}:{port}")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the DroneGuard Multiverse demo API and web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    run_dev_server(args.host, args.port)


if __name__ == "__main__":
    main()
