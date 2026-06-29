from __future__ import annotations

import pytest

from droneguard_multiverse.paths import DATA_DIR
from droneguard_multiverse.schemas.scenario import load_scenario, load_scenarios
from droneguard_multiverse.schemas.telemetry import TelemetryValidationError, load_telemetry_csv
from droneguard_multiverse.simulation.reachability import estimate_reachability


def test_loader_returns_demo_scenarios() -> None:
    scenarios = {scenario.scenario_id: scenario for scenario in load_scenarios()}

    assert len(scenarios) == 2
    assert "dangerous_detour_low_battery" in scenarios
    assert "alexanderplatz_restricted" in scenarios
    assert scenarios["dangerous_detour_low_battery"].expected_action == "return_to_start"
    assert scenarios["alexanderplatz_restricted"].expected_action == "detour_obstacle"


def test_telemetry_parser_accepts_sample_csv() -> None:
    scenario = load_scenario("alexanderplatz_restricted")
    rows = load_telemetry_csv(scenario.resolve_asset_path(scenario.assets.telemetry_csv, DATA_DIR))

    assert rows[0].battery_pct == 78.0
    assert rows[-1].estimated_remaining_range_m == 920.0


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


def test_reachability_flags_alexanderplatz_detour_as_safe() -> None:
    scenario = load_scenario("alexanderplatz_restricted")
    rows = load_telemetry_csv(scenario.resolve_asset_path(scenario.assets.telemetry_csv, DATA_DIR))

    estimate = estimate_reachability(scenario, rows)

    assert estimate.can_complete_final_waypoint_and_return is True
    assert estimate.required_range_with_detour_m == 760.0
    assert estimate.reserve_after_return_m == 160.0
