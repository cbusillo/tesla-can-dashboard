from pathlib import Path

import pytest


@pytest.fixture
def telemetry_dbc(tmp_path: Path) -> Path:
    path = tmp_path / "synthetic.dbc"
    path.write_text("""VERSION "synthetic behavior fixture"
NS_ :
BS_:
BU_: TEST
BO_ 100 Drive: 8 TEST
 SG_ DI_vehicleSpeed : 0|16@1+ (0.01,0) [0|450] "kph" TEST
 SG_ DI_gear : 16|3@1+ (1,0) [0|7] "" TEST
BO_ 101 Battery: 8 TEST
 SG_ BMS_socUI : 0|16@1+ (0.01,0) [0|100] "%" TEST
 SG_ BMS_nominalEnergyRemaining : 16|16@1+ (0.01,0) [0|250] "KWh" TEST
 SG_ BMS_minPackTemperature : 32|16@1- (0.01,0) [-60|150] "deg C" TEST
 SG_ BMS_maxPackTemperature : 48|16@1- (0.01,0) [-60|150] "deg C" TEST
BO_ 102 Charging: 8 TEST
 SG_ ChargeLinePower264 : 0|16@1+ (1,0) [0|65000] "W" TEST
 SG_ UI_chargeTerminationPct : 16|16@1+ (0.01,0) [0|100] "%" TEST
VAL_ 100 DI_gear 0 "DI_GEAR_INVALID" 1 "DI_GEAR_P" 2 "DI_GEAR_R" 3 "DI_GEAR_N" 4 "DI_GEAR_D" 7 "DI_GEAR_SNA";
VAL_ 100 DI_vehicleSpeed 65535 "SNA";
""")
    return path
