"""Behavior check for the VWAP + bearish FVG candle SELL condition."""
import json
from pathlib import Path


def sell_events(rows, cooldown=6):
    events = []
    last_event = None
    day_key = None
    price_volume = 0.0
    total_volume = 0.0
    previous_vwap = None

    for index, row in enumerate(rows):
        open_price, high, low, close, volume = map(float, row[1:6])
        current_day = int(row[0]) // 86_400_000
        if current_day != day_key:
            price_volume = 0.0
            total_volume = 0.0
            day_key = current_day

        price_volume += ((high + low + close) / 3.0) * volume
        total_volume += volume
        session_vwap = price_volume / total_volume if total_volume else None

        bearish_fvg = (
            index >= 2
            and high < float(rows[index - 2][3])
            and float(rows[index - 1][4]) < float(rows[index - 2][3])
        )
        displacement_open = float(rows[index - 1][1]) if index >= 1 else None
        displacement_close = float(rows[index - 1][4]) if index >= 1 else None
        red_body_touch = (
            bearish_fvg
            and displacement_close < displacement_open
            and displacement_close <= previous_vwap <= displacement_open
        )
        spacing_ok = last_event is None or index - last_event >= cooldown

        if red_body_touch and spacing_ok:
            events.append((index, index - 1, previous_vwap))
            last_event = index

        previous_vwap = session_vwap

    return events


if __name__ == "__main__":
    rows = json.loads(Path("fvg-cross-check-candles.json").read_text(encoding="utf-8-sig"))
    events = sell_events(rows)

    for end in range(3, len(rows) + 1, 23):
        assert sell_events(rows[:end]) == [event for event in events if event[0] < end]

    assert all(second[0] - first[0] >= 6 for first, second in zip(events, events[1:]))
    for index, marked_index, session_vwap in events:
        high = float(rows[index][2])
        open_price = float(rows[marked_index][1])
        close = float(rows[marked_index][4])
        assert marked_index == index - 1
        assert high < float(rows[index - 2][3])
        assert float(rows[index - 1][4]) < float(rows[index - 2][3])
        assert close < open_price
        assert close <= session_vwap <= open_price

    print(f"PASS: {len(events)} SELL events; every marker is placed on the red middle FVG candle whose body contains Session VWAP, after next-candle confirmation, with six-bar spacing and stable history.")
