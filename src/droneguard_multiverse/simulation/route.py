from __future__ import annotations

from math import atan2, cos, radians, sin, sqrt
from typing import Protocol


EARTH_RADIUS_M = 6_371_000.0


class PointLike(Protocol):
    lat: float
    lon: float


def haversine_m(a: PointLike, b: PointLike) -> float:
    lat_1 = radians(a.lat)
    lat_2 = radians(b.lat)
    delta_lat = radians(b.lat - a.lat)
    delta_lon = radians(b.lon - a.lon)
    value = sin(delta_lat / 2.0) ** 2 + cos(lat_1) * cos(lat_2) * sin(delta_lon / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_M * atan2(sqrt(value), sqrt(1.0 - value))


def path_distance_m(points: list[PointLike] | tuple[PointLike, ...]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(haversine_m(start, end) for start, end in zip(points, points[1:]))
