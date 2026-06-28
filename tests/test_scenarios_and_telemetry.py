from __future__ import annotations

import pytest

from droneguard_multiverse.paths import DATA_DIR
from droneguard_multiverse.schemas.scenario import load_scenario, load_scenarios
from droneguard_multiverse.schemas.telemetry import TelemetryValidationError, load_telemetry_csv
from droneguard_multiverse.simulation.reachability import estimate_reachability


def test_loader_returns_safe_and_dangerous_scenarios() -> None:
    scenarios = {scenario.scenario_id: scenario for scenario in load_scenarios()}

    assert "safe_mission" in scenarios
    assert "dangerous_detour_low_battery" in scenarios
    assert scenarios["safe_mission"].expected_action == "continue_mission"
    assert scenarios["dangerous_detour_low_battery"].expected_action == "return_to_start"


def test_telemetry_parser_accepts_sample_csv() -> None:
    scenario = load_scenario("safe_mission")
    rows = load_telemetry_csv(scenario.resolve_asset_path(scenario.assets.telemetry_csv, DATA_DIR))

    assert rows[0].battery_pct == 82.0
    assert rows[-1].estimated_remaining_range_m == 1280.0


def test_telemetry_parser_rejects_missing_columns(tmp_path) -> None:
    bad_csv = tmp_path / "bad.csv"
    bad_csv.write_text("timestamp,lat,lon\n2026-06-28T10:00:00Z,1,2\n", encoding="utf-8")

    with pytest.raises(TelemetryValidationError, match="missing required columns"):
        load_telemetry_csv(bad_csv)


def test_reachability_flags_dangerous_mission_as_unsafe() -> None:
    scenario = load_scenario("dangerous_detour_low_battery")
    rows = load_telemetry_csv(scenario.resolve_asset_path(scenario.assets.telemetry_csv, DATA_DIR))

    estimate = estimate_reachability(scenario, rows)

    assert estimate.can_complete_final_waypoint_and_return is False
    assert estimate.required_range_with_detour_m == 690.0
    assert estimate.reserve_after_return_m == -230.0
