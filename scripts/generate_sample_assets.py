from __future__ import annotations

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
WIDTH = 640
HEIGHT = 360


def main() -> None:
    generate_sequence("safe", obstacle=False)
    generate_sequence("dangerous", obstacle=True)


def generate_sequence(name: str, *, obstacle: bool) -> None:
    output_dir = ROOT / "data" / "samples" / name / "frames"
    output_dir.mkdir(parents=True, exist_ok=True)
    drone_positions = [(165, 238), (305, 175), (450, 126)]
    for index, drone in enumerate(drone_positions, start=1):
        pixels = make_canvas()
        draw_grid(pixels)
        draw_route(pixels, [(92, 286), (210, 228), (350, 168), (515, 98)], (45, 84, 116))
        if obstacle:
            draw_route(pixels, [(350, 168), (438, 205), (515, 98)], (198, 116, 33))
            draw_obstacle(pixels, (385, 135))
        draw_waypoints(pixels, [(92, 286), (210, 228), (350, 168), (515, 98)])
        draw_drone(pixels, drone)
        draw_horizon(pixels, obstacle)
        write_png(output_dir / f"frame_{index:03d}.png", pixels)


def make_canvas() -> list[list[tuple[int, int, int]]]:
    return [[(230, 236, 233) for _ in range(WIDTH)] for _ in range(HEIGHT)]


def draw_grid(pixels: list[list[tuple[int, int, int]]]) -> None:
    for x in range(0, WIDTH, 40):
        draw_line(pixels, (x, 0), (x, HEIGHT - 1), (203, 214, 211))
    for y in range(0, HEIGHT, 40):
        draw_line(pixels, (0, y), (WIDTH - 1, y), (203, 214, 211))


def draw_horizon(pixels: list[list[tuple[int, int, int]]], obstacle: bool) -> None:
    color = (177, 205, 219) if not obstacle else (209, 190, 170)
    for y in range(0, 86):
        for x in range(WIDTH):
            pixels[y][x] = color
    draw_rect(pixels, 0, 86, WIDTH, 91, (118, 143, 113))


def draw_route(
    pixels: list[list[tuple[int, int, int]]],
    points: list[tuple[int, int]],
    color: tuple[int, int, int],
) -> None:
    for start, end in zip(points, points[1:]):
        for offset in range(-3, 4):
            draw_line(pixels, (start[0], start[1] + offset), (end[0], end[1] + offset), color)


def draw_waypoints(pixels: list[list[tuple[int, int, int]]], points: list[tuple[int, int]]) -> None:
    for x, y in points:
        draw_circle(pixels, x, y, 12, (248, 248, 244))
        draw_circle(pixels, x, y, 7, (31, 91, 115))


def draw_drone(pixels: list[list[tuple[int, int, int]]], center: tuple[int, int]) -> None:
    x, y = center
    draw_circle(pixels, x, y, 14, (27, 63, 95))
    draw_line(pixels, (x - 22, y), (x + 22, y), (27, 63, 95))
    draw_line(pixels, (x, y - 22), (x, y + 22), (27, 63, 95))
    for dx, dy in [(-28, 0), (28, 0), (0, -28), (0, 28)]:
        draw_circle(pixels, x + dx, y + dy, 8, (232, 244, 241))
        draw_circle(pixels, x + dx, y + dy, 4, (16, 46, 70))


def draw_obstacle(pixels: list[list[tuple[int, int, int]]], top_left: tuple[int, int]) -> None:
    x, y = top_left
    draw_rect(pixels, x, y, x + 110, y + 18, (141, 65, 42))
    draw_rect(pixels, x + 44, y - 42, x + 62, y + 80, (141, 65, 42))
    draw_line(pixels, (x + 53, y - 42), (x + 14, y + 76), (141, 65, 42))
    draw_line(pixels, (x + 53, y - 42), (x + 96, y + 76), (141, 65, 42))
    draw_rect(pixels, x - 12, y + 80, x + 124, y + 92, (112, 75, 54))


def draw_rect(
    pixels: list[list[tuple[int, int, int]]],
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: tuple[int, int, int],
) -> None:
    for y in range(max(0, y1), min(HEIGHT, y2)):
        for x in range(max(0, x1), min(WIDTH, x2)):
            pixels[y][x] = color


def draw_circle(
    pixels: list[list[tuple[int, int, int]]],
    cx: int,
    cy: int,
    radius: int,
    color: tuple[int, int, int],
) -> None:
    radius_sq = radius * radius
    for y in range(max(0, cy - radius), min(HEIGHT, cy + radius + 1)):
        for x in range(max(0, cx - radius), min(WIDTH, cx + radius + 1)):
            if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius_sq:
                pixels[y][x] = color


def draw_line(
    pixels: list[list[tuple[int, int, int]]],
    start: tuple[int, int],
    end: tuple[int, int],
    color: tuple[int, int, int],
) -> None:
    x1, y1 = start
    x2, y2 = end
    dx = abs(x2 - x1)
    dy = -abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    error = dx + dy
    while True:
        if 0 <= x1 < WIDTH and 0 <= y1 < HEIGHT:
            pixels[y1][x1] = color
        if x1 == x2 and y1 == y2:
            break
        e2 = 2 * error
        if e2 >= dy:
            error += dy
            x1 += sx
        if e2 <= dx:
            error += dx
            y1 += sy


def write_png(path: Path, pixels: list[list[tuple[int, int, int]]]) -> None:
    raw_rows = []
    for row in pixels:
        raw_rows.append(b"\x00" + b"".join(bytes(pixel) for pixel in row))
    raw = b"".join(raw_rows)
    data = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(data)


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


if __name__ == "__main__":
    main()
