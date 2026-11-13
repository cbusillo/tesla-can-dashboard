import sqlite3
import subprocess
import sys
import time

import pytest

from tesla_can_dashboard import battery_history as history_module
from tesla_can_dashboard import engine as engine_module
from tesla_can_dashboard.battery_history import BatteryHistory
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder
from tesla_can_dashboard.signals import SignalStore


def test_history_survives_restart_without_turning_missing_or_stale_into_values(tmp_path) -> None:
    store = SignalStore(2)
    store.update({"fullPackEnergyKwh": 74, "currentA": None}, {1: 3.9}, 1000, now=0)
    path = tmp_path / "battery.sqlite3"
    history = BatteryHistory(path, reserve_bytes=0)
    assert history.append(store.snapshot(now=0), 1000)
    assert not history.append(store.snapshot(now=31), 1031)
    rows = BatteryHistory(path, reserve_bytes=0).read(0)["observations"]
    assert len(rows) == 1
    assert rows[0]["signals"]["fullPackEnergyKwh"] == 74
    assert rows[0]["signals"]["currentA"] is None
    assert rows[0]["cellSpreadMv"] is None
    assert rows[0]["cellGroups"] == [3.9, None]


def test_retention_is_bounded_by_observation_count_even_when_clock_goes_back(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3", limit=3, reserve_bytes=0)
    store = SignalStore(2)
    for timestamp in [100, 101, 102, 50]:
        store.update({"fullPackEnergyKwh": timestamp}, {1: 3.9, 2: 3.91}, timestamp, now=0)
        history.append(store.snapshot(now=0), timestamp)
    rows = history.read(0)["observations"]
    assert [row["timestamp"] for row in rows] == [101, 102, 50]
    assert rows[-1]["cellSpreadMv"] > 0


def test_sampled_queries_keep_latest_observation_and_report_original_count(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    store = SignalStore(1)
    for timestamp in range(30):
        store.update({"fullPackEnergyKwh": 74}, {}, timestamp, now=0)
        history.append(store.snapshot(now=0), timestamp)
    result = history.read(10, points=4)
    assert result["count"] == 20
    assert len(result["observations"]) <= 5
    assert result["observations"][-1]["timestamp"] == 29


def test_reading_history_does_not_create_storage(tmp_path) -> None:
    path = tmp_path / "missing" / "battery.sqlite3"
    assert BatteryHistory(path, reserve_bytes=0).read(0)["observations"] == []
    assert not path.exists()


def test_history_recovers_file_created_before_first_schema_commit(tmp_path) -> None:
    path = tmp_path / "battery.sqlite3"
    sqlite3.connect(path).close()
    assert BatteryHistory(path, reserve_bytes=0).read(0)["observations"] == []


def test_collector_uses_live_store_during_replay_without_requiring_raw_recording(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(engine_module, "SETTLE_SECONDS", 0)
    engine = Engine("can0", Recorder(tmp_path / "recordings", reserve_bytes=0))
    engine.battery_history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    engine.store.update({"fullPackEnergyKwh": 74}, {}, 1000)
    engine.replay_store = SignalStore()
    engine.replay_store.update({"fullPackEnergyKwh": 10}, {}, 1000)
    append = engine.battery_history.append

    def collect_once(snapshot: dict, timestamp: float) -> bool:
        engine.stop_event.set()
        return append(snapshot, timestamp)

    monkeypatch.setattr(engine.battery_history, "append", collect_once)
    engine._collect_battery_history()
    assert engine.battery_history.read(0)["observations"][0]["signals"]["fullPackEnergyKwh"] == 74


def test_history_write_failure_leaves_live_measurements_available(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(engine_module, "SETTLE_SECONDS", 0)
    engine = Engine("can0", Recorder(tmp_path / "recordings", reserve_bytes=0))
    engine.battery_history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    engine.store.update({"fullPackEnergyKwh": 74}, {}, 1000)

    def fail_once(*_args: object) -> bool:
        engine.stop_event.set()
        raise OSError("storage unavailable")

    monkeypatch.setattr(engine.battery_history, "append", fail_once)
    engine._collect_battery_history()
    assert engine.battery_history.error


def test_replay_or_disconnected_observations_never_enter_history(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    store = SignalStore()
    store.update({"fullPackEnergyKwh": 74}, {}, 1000, now=0)
    replay = store.snapshot(now=0)
    replay["mode"] = "replay"
    assert not history.append(replay, 1000)
    assert not history.append(store.snapshot(now=10), 1010)
    assert not history.path.exists()


def test_collector_waits_for_wake_readings_to_settle(tmp_path, monkeypatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    engine = Engine("can0", Recorder(tmp_path / "recordings", reserve_bytes=0), cell_count=2)
    engine.battery_history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    engine.store.update({"voltageV": 380}, {}, 1000, now=0)
    append = engine.battery_history.append

    def collect_once(snapshot: dict, timestamp: float) -> bool:
        engine.stop_event.set()
        return append(snapshot, timestamp)

    def wake_updates(_seconds: float) -> bool:
        clock[0] += 5
        engine.store.update({"voltageV": 380}, {}, 1000 + clock[0])
        if clock[0] >= 10:
            engine.store.update({"fullPackEnergyKwh": 74}, {1: 3.9, 2: 3.91}, 1000 + clock[0])
        return engine.stop_event.is_set()

    monkeypatch.setattr(engine.battery_history, "append", collect_once)
    monkeypatch.setattr(engine.stop_event, "wait", wake_updates)
    engine._collect_battery_history()
    rows = engine.battery_history.read(0)["observations"]
    assert len(rows) == 1
    assert rows[0]["signals"]["fullPackEnergyKwh"] == 74
    assert rows[0]["cellSpreadMv"] is not None


def test_history_leaves_existing_data_untouched_when_storage_reserve_is_reached(tmp_path, monkeypatch) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    store = SignalStore()
    store.update({"fullPackEnergyKwh": 74}, {}, 1000, now=0)
    history.append(store.snapshot(now=0), 1000)
    monkeypatch.setattr(history_module, "has_storage_space", lambda *_args: False)
    with pytest.raises(OSError):
        history.append(store.snapshot(now=0), 1001)
    assert [row["timestamp"] for row in history.read(0)["observations"]] == [1000]


def test_history_read_recovers_an_interrupted_sqlite_transaction(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3", reserve_bytes=0)
    store = SignalStore()
    store.update({"fullPackEnergyKwh": 74}, {}, 1000, now=0)
    history.append(store.snapshot(now=0), 1000)
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import os,sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('PRAGMA cache_size=1'); "
            "db.execute('BEGIN IMMEDIATE'); db.execute('UPDATE observations SET payload=?', ('x'*100000,)); os._exit(0)",
            str(history.path),
        ],
        check=True,
    )
    assert history.read(0)["observations"][0]["signals"]["fullPackEnergyKwh"] == 74
