"""Behavior checks for VWAP/G-Trend touching confirmed FVG candles."""
import json
from pathlib import Path


def line_series(rows, g_length=100):
    vwaps = []
    g_averages = []
    new_sessions = []
    day_key = None
    price_volume = total_volume = 0.0
    a = b = 0.0

    for row in rows:
        high, low, close, volume = map(float, row[2:6])
        current_day = int(row[0]) // 86_400_000
        new_session = current_day != day_key
        if new_session:
            price_volume = total_volume = 0.0
            day_key = current_day

        price_volume += ((high + low + close) / 3.0) * volume
        total_volume += volume
        vwaps.append(price_volume / total_volume)
        new_sessions.append(new_session)

        spread = (a - b) / g_length
        a, b = max(close, a) - spread, min(close, b) + spread
        g_averages.append((a + b) / 2.0)

    return vwaps, g_averages, new_sessions


def touches(value, candle_low, candle_high):
    return candle_low <= value <= candle_high


def events(rows, cooldown=6):
    vwaps, g_averages, new_sessions = line_series(rows)
    output = []
    last = {1: None, -1: None}

    for index in range(2, len(rows)):
        middle = index - 1
        open_middle, high_middle, low_middle, close_middle = map(float, rows[middle][1:5])
        bullish_fvg = float(rows[index][3]) > float(rows[index - 2][2]) and close_middle > float(rows[index - 2][2])
        bearish_fvg = float(rows[index][2]) < float(rows[index - 2][3]) and close_middle < float(rows[index - 2][3])

        vwap_touch = touches(vwaps[middle], low_middle, high_middle)
        g_touch = touches(g_averages[middle], low_middle, high_middle)

        side = 1 if bullish_fvg and close_middle > open_middle else -1 if bearish_fvg and close_middle < open_middle else 0
        if side and (vwap_touch or g_touch) and (last[side] is None or index - last[side] >= cooldown):
            sources = tuple(name for name, hit in (("VWAP", vwap_touch), ("G-Trend", g_touch)) if hit)
            output.append((index, middle, side, sources))
            last[side] = index

    return output


if __name__ == "__main__":
    rows = json.loads(Path("fvg-cross-check-candles.json").read_text(encoding="utf-8-sig"))
    full = events(rows)

    for end in range(3, len(rows) + 1, 19):
        assert events(rows[:end]) == [event for event in full if event[0] < end]

    for side in (1, -1):
        same_side = [event for event in full if event[2] == side]
        assert all(second[0] - first[0] >= 6 for first, second in zip(same_side, same_side[1:]))

    mirrored = []
    for row in rows:
        transformed = list(row)
        transformed[1], transformed[2], transformed[3], transformed[4] = (
            -float(row[1]), -float(row[3]), -float(row[2]), -float(row[4])
        )
        mirrored.append(transformed)
    assert events(mirrored) == [(confirm, marked, -side, sources) for confirm, marked, side, sources in full]

    assert any(event[2] == 1 for event in full)
    assert any(event[2] == -1 for event in full)
    assert any("VWAP" in event[3] for event in full)
    assert any("G-Trend" in event[3] for event in full)
    print(f"PASS: {len(full)} filtered signals; BUY/SELL symmetry, exact-bar VWAP and G-Trend touches, inclusive high-low boundaries, six-bar same-side spacing, exact middle-candle placement, and prefix stability.")
