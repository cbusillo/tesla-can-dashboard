from tesla_can_dashboard.battery_history import BatteryHistory
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder
from tesla_can_dashboard.signals import SignalStore


def test_history_survives_restart_without_turning_missing_or_stale_into_values(tmp_path) -> None:
    store = SignalStore(2)
    store.update({"fullPackEnergyKwh": 74, "currentA": None}, {1: 3.9}, 1000, now=0)
    path = tmp_path / "battery.sqlite3"
    history = BatteryHistory(path)
    assert history.append(store.snapshot(now=0), 1000, "first")
    assert not history.append(store.snapshot(now=31), 1031, "first")
    rows = BatteryHistory(path).read(0)["observations"]
    assert len(rows) == 1
    assert rows[0]["signals"]["fullPackEnergyKwh"] == 74
    assert rows[0]["signals"]["currentA"] is None
    assert rows[0]["cellSpreadMv"] is None
    assert rows[0]["cellGroups"] == [3.9, None]


def test_retention_is_bounded_by_observation_count_even_when_clock_goes_back(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3", limit=3)
    store = SignalStore(2)
    for timestamp in [100, 101, 102, 50]:
        store.update({"fullPackEnergyKwh": timestamp}, {1: 3.9, 2: 3.91}, timestamp, now=0)
        history.append(store.snapshot(now=0), timestamp, str(timestamp))
    rows = history.read(0)["observations"]
    assert [row["timestamp"] for row in rows] == [101, 102, 50]
    assert rows[-1]["cellSpreadMv"] > 0
    assert rows[-1]["capture"] != rows[-2]["capture"]


def test_sampled_queries_keep_latest_observation_and_report_original_count(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3")
    store = SignalStore(1)
    for timestamp in range(30):
        store.update({"fullPackEnergyKwh": 74}, {}, timestamp, now=0)
        history.append(store.snapshot(now=0), timestamp, "capture")
    result = history.read(10, points=4)
    assert result["count"] == 20
    assert len(result["observations"]) <= 5
    assert result["observations"][-1]["timestamp"] == 29


def test_reading_history_does_not_create_storage(tmp_path) -> None:
    path = tmp_path / "missing" / "battery.sqlite3"
    assert BatteryHistory(path).read(0)["observations"] == []
    assert not path.exists()


def test_collector_uses_live_store_during_replay_without_requiring_raw_recording(tmp_path, monkeypatch) -> None:
    engine = Engine("can0", Recorder(tmp_path / "recordings", reserve_bytes=0))
    engine.battery_history = BatteryHistory(tmp_path / "battery.sqlite3")
    engine.store.update({"fullPackEnergyKwh": 74}, {}, 1000)
    engine.replay_store = SignalStore()
    engine.replay_store.update({"fullPackEnergyKwh": 10}, {}, 1000)
    append = engine.battery_history.append

    def collect_once(snapshot: dict, timestamp: float, capture: str) -> bool:
        engine.stop_event.set()
        return append(snapshot, timestamp, capture)

    monkeypatch.setattr(engine.battery_history, "append", collect_once)
    engine._collect_battery_history()
    assert engine.battery_history.read(0)["observations"][0]["signals"]["fullPackEnergyKwh"] == 74
    assert engine.recorder.active_id is None


def test_history_write_failure_leaves_live_measurements_available(tmp_path, monkeypatch) -> None:
    engine = Engine("can0", Recorder(tmp_path / "recordings", reserve_bytes=0))
    engine.battery_history = BatteryHistory(tmp_path / "battery.sqlite3")
    engine.store.update({"fullPackEnergyKwh": 74}, {}, 1000)

    def fail_once(*_args: object) -> bool:
        engine.stop_event.set()
        raise OSError("storage unavailable")

    monkeypatch.setattr(engine.battery_history, "append", fail_once)
    engine._collect_battery_history()
    assert engine.battery_history.error
    assert engine.store.snapshot()["signals"]["fullPackEnergyKwh"]["value"] == 74


def test_replay_or_disconnected_observations_never_enter_history(tmp_path) -> None:
    history = BatteryHistory(tmp_path / "battery.sqlite3")
    store = SignalStore()
    store.update({"fullPackEnergyKwh": 74}, {}, 1000, now=0)
    replay = store.snapshot(now=0)
    replay["mode"] = "replay"
    assert not history.append(replay, 1000, "replay")
    assert not history.append(store.snapshot(now=10), 1010, "stale")
    assert not history.path.exists()
