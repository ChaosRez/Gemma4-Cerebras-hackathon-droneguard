from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from droneguard_multiverse.cache.keys import cache_filename
from droneguard_multiverse.paths import DATA_DIR


class CacheMissError(FileNotFoundError):
    pass


class ResponseCache:
    def __init__(self, cache_dir: Path | None = None) -> None:
        self.cache_dir = cache_dir or DATA_DIR / "cache"
        self.entries_dir = self.cache_dir / "entries"
        self.seed_dir = self.cache_dir / "seeds"
        self.entries_dir.mkdir(parents=True, exist_ok=True)

    def load(self, cache_key: str, scenario_id: str, agent: str) -> dict[str, Any]:
        entry_path = self.entries_dir / cache_filename(cache_key)
        if entry_path.exists():
            entry = json.loads(entry_path.read_text(encoding="utf-8"))
        else:
            seed_path = self.seed_dir / scenario_id / f"{agent}.json"
            if not seed_path.exists():
                raise CacheMissError(f"no cached response for {scenario_id}/{agent}")
            entry = json.loads(seed_path.read_text(encoding="utf-8"))
        replay_entry = deepcopy(entry)
        replay_entry["cache_key"] = cache_key
        replay_entry["mode"] = "replay"
        replay_entry["cache_hit"] = True
        return replay_entry

    def store(self, entry: dict[str, Any]) -> Path:
        payload = deepcopy(entry)
        payload.setdefault("created_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        payload["cache_hit"] = False
        path = self.entries_dir / cache_filename(str(payload["cache_key"]))
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return path

    def load_by_key(self, cache_key: str) -> dict[str, Any]:
        entry_path = self.entries_dir / cache_filename(cache_key)
        if not entry_path.exists():
            raise CacheMissError(f"cache entry not found: {cache_key}")
        return json.loads(entry_path.read_text(encoding="utf-8"))
