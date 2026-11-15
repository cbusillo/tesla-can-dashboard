from pathlib import Path

import pytest

from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.signals import SignalStore


@pytest.fixture
def drive_readings_dbc(tmp_path: Path) -> Path:
    path = tmp_path / "drive-readings.dbc"
    path.write_text("""VERSION "synthetic behavior fixture"
NS_ :
BS_:
BU_: TEST
BO_ 201 Front: 3 TEST
 SG_ DIF_tempIndex M : 0|4@1+ (1,0) [0|15] "" TEST
 SG_ DIF_statorT m0 : 8|8@1+ (1,-40) [-39|215] "DegC" TEST
 SG_ DIF_inverterT m0 : 16|8@1+ (1,-40) [-40|215] "DegC" TEST
 SG_ UnrelatedFront m1 : 8|8@1+ (1,0) [0|255] "" TEST
BO_ 202 Rear: 3 TEST
 SG_ DIR_tempIndex M : 0|4@1+ (1,0) [0|15] "" TEST
 SG_ DIR_statorT m0 : 8|8@1+ (1,-40) [-39|215] "C" TEST
 SG_ DIR_inverterT m0 : 16|8@1+ (1,-40) [-40|215] "C" TEST
 SG_ UnrelatedRear m1 : 8|8@1+ (1,0) [0|255] "" TEST
BO_ 203 Display: 4 TEST
 SG_ VCSEC_TPMSDisplayPressureFL : 0|8@1+ (0.025,0) [0|6.35] "bar" TEST
 SG_ VCSEC_TPMSDisplayPressureFR : 8|8@1+ (0.025,0) [0|6.35] "bar" TEST
 SG_ VCSEC_TPMSDisplayPressureRL : 16|8@1+ (0.025,0) [0|6.35] "bar" TEST
 SG_ VCSEC_TPMSDisplayPressureRR : 24|8@1+ (0.025,0) [0|6.35] "bar" TEST
BO_ 204 Sensor: 2 TEST
 SG_ VCSEC_TPMSPressure0 : 0|8@1+ (0.025,0) [0|6.35] "bar" TEST
 SG_ VCSEC_TPMSLastKnownPressureFL : 8|8@1+ (0.025,0) [0|6.35] "bar" TEST
VAL_ 201 DIF_statorT 0 "SNA";
VAL_ 202 DIR_statorT 0 "SNA";
VAL_ 203 VCSEC_TPMSDisplayPressureFL 255 "SNA";
VAL_ 203 VCSEC_TPMSDisplayPressureFR 255 "SNA";
VAL_ 203 VCSEC_TPMSDisplayPressureRL 255 "SNA";
VAL_ 203 VCSEC_TPMSDisplayPressureRR 255 "SNA";
""")
    return path


@pytest.mark.parametrize("identifier,key", [(201, "frontMotorTemperatureC"), (202, "rearMotorTemperatureC")])
def test_motor_mux_does_not_refresh_temperature_from_other_pages_or_expose_inverter(
    drive_readings_dbc: Path, identifier: int, key: str
) -> None:
    decoder = Decoder(drive_readings_dbc)
    values, cells = decoder.decode(identifier, bytes([0, 68, 80]))
    assert values == {key: 28}
    assert cells == {}
    store = SignalStore()
    store.update(values, {}, 100, now=0)
    for page in (1, 7):
        values, _ = decoder.decode(identifier, bytes([page, 200, 200]))
        assert values == {}
        store.update(values, {}, 102, now=2)
    reading = store.snapshot(now=4)["signals"][key]
    assert reading["quality"] == "stale"
    assert reading["value"] == 28
    values, _ = decoder.decode(identifier, bytes([0, 0, 80]))
    assert values == {key: None}
    with pytest.raises(ValueError, match="frame length"):
        decoder.decode(identifier, b"\0")


def test_displayed_pressure_never_uses_sensor_or_last_known_values_and_preserves_zero(drive_readings_dbc: Path) -> None:
    decoder = Decoder(drive_readings_dbc)
    assert decoder.decode(204, bytes([152, 116])) == ({}, {})
    values, _ = decoder.decode(203, bytes([120, 0, 255, 254]))
    assert values == {
        "displayedFrontLeftPressureBar": pytest.approx(3),
        "displayedFrontRightPressureBar": 0,
        "displayedRearLeftPressureBar": None,
        "displayedRearRightPressureBar": pytest.approx(6.35),
    }
    store = SignalStore()
    store.update(values, {}, 100, now=0)
    snapshot = store.snapshot(now=1)["signals"]
    assert snapshot["displayedRearLeftPressureBar"]["quality"] == "invalid"
    assert snapshot["displayedFrontRightPressureBar"]["quality"] == "fresh"
    assert snapshot["displayedFrontRightPressureBar"]["value"] == 0
    assert store.snapshot(now=4)["signals"]["displayedFrontLeftPressureBar"]["quality"] == "stale"
