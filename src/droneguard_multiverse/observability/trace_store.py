from __future__ import annotations

import json
from pathlib import Path

from droneguard_multiverse.observability.events import TraceEvent
from droneguard_multiverse.paths import TRACE_DIR


class TraceStore:
    def __init__(self, run_id: str, trace_dir: Path = TRACE_DIR) -> None:
        self.run_id = run_id
        self.trace_dir = trace_dir
        self.trace_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.trace_dir / f"{run_id}.jsonl"
        self.events: list[TraceEvent] = []

    def append(self, event: TraceEvent) -> None:
        self.events.append(event)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event.to_dict(), sort_keys=True) + "\n")

    def to_list(self) -> list[dict]:
        return [event.to_dict() for event in self.events]

    @classmethod
    def read_run(cls, run_id: str, trace_dir: Path = TRACE_DIR) -> list[dict]:
        path = trace_dir / f"{run_id}.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
