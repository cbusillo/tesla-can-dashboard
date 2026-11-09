import math
import re
import struct
from pathlib import Path

import cantools

SIGNAL_NAMES = {
    "BMS_dcLinkVoltage": "voltageV",
    "BMS_packCurrent": "currentA",
    "BMS_socUI": "displayedChargePercent",
    "BMS_nominalFullPackEnergy": "fullPackEnergyKwh",
    "BMS_nominalEnergyRemaining": "remainingEnergyKwh",
    "BMS_minPackTemperature": "minimumTemperatureC",
    "BMS_maxPackTemperature": "maximumTemperatureC",
}
CELL_NAME = re.compile(r"BMS_brickVoltage(\d+)$")


class Decoder:
    def __init__(self, dbc: Path | None = None) -> None:
        self.database = cantools.database.load_file(dbc, strict=False) if dbc else None
        self.messages = (
            {}
            if self.database is None
            else {
                message.frame_id: message
                for message in self.database.messages
                if any(signal.name in SIGNAL_NAMES or CELL_NAME.fullmatch(signal.name) for signal in message.signals)
            }
        )
        self.frame_ids = set(self.messages) if self.database else {0x132, 0x292}

    def decode(self, identifier: int, data: bytes) -> tuple[dict[str, float], dict[int, float | None]]:
        if identifier not in self.frame_ids:
            return {}, {}
        if self.database is None:
            return self._basic(identifier, data), {}
        message = self.messages[identifier]
        if len(data) != message.length:
            raise ValueError("Wrong CAN frame length")
        decoded = message.decode(data, decode_choices=False, allow_truncated=False)
        values = {
            SIGNAL_NAMES[name]: float(value)
            for name, value in decoded.items()
            if name in SIGNAL_NAMES and isinstance(value, (int, float)) and math.isfinite(value)
        }
        cells = {}
        for name, value in decoded.items():
            match = CELL_NAME.fullmatch(name)
            if match is None:
                continue
            index = int(match.group(1))
            status = decoded.get(f"BMS_brickVoltageStatus{index}")
            cells[index] = float(value) if status == 2 and isinstance(value, (int, float)) and math.isfinite(value) else None
        return values, cells

    @staticmethod
    def _basic(identifier: int, data: bytes) -> dict[str, float]:
        if len(data) != 8:
            raise ValueError("Wrong CAN frame length")
        if identifier == 0x132:
            voltage, current = struct.unpack_from("<Hh", data)
            return {"voltageV": voltage * 0.01, "currentA": current * 0.1}
        value = ((int.from_bytes(data, "little") >> 10) & 0x3FF) * 0.1
        return {"displayedChargePercent": value}
