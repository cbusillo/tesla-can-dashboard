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
    "DI_vehicleSpeed": "speedKmh",
    "DI_gear": "driveGear",
    "ChargeLinePower264": "chargingPowerKw",
    "UI_chargeTerminationPct": "chargeLimitPercent",
}
UNIT_FACTORS = {
    "voltageV": {"V": 1, "mV": 0.001},
    "currentA": {"A": 1, "mA": 0.001},
    "displayedChargePercent": {"%": 1},
    "fullPackEnergyKwh": {"kWh": 1, "KWh": 1, "Wh": 0.001},
    "remainingEnergyKwh": {"kWh": 1, "KWh": 1, "Wh": 0.001},
    "minimumTemperatureC": {"deg C": 1, "degC": 1, "°C": 1, "C": 1},
    "maximumTemperatureC": {"deg C": 1, "degC": 1, "°C": 1, "C": 1},
    "speedKmh": {"MPH": 1.609344, "mph": 1.609344, "kph": 1, "km/h": 1},
    "driveGear": {None: 1, "": 1},
    "chargingPowerKw": {"kW": 1, "W": 0.001},
    "chargeLimitPercent": {"%": 1},
}
GEARS = {"DI_GEAR_P": 1, "DI_GEAR_R": 2, "DI_GEAR_N": 3, "DI_GEAR_D": 4}
CELL_NAME = re.compile(r"BMS_brickVoltage(\d+)$")
INVALID_CHOICES = {"SNA", "INVALID", "NOT_AVAILABLE"}


class Decoder:
    def __init__(self, dbc: Path | None = None) -> None:
        database = None
        if dbc is not None:
            database = cantools.database.can.Database(strict=False)
            database.add_dbc_file(dbc)
        self.database = database
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

    def signal_keys(self, identifier: int) -> set[str]:
        if self.database is None:
            return {"voltageV", "currentA"} if identifier == 0x132 else {"displayedChargePercent"} if identifier == 0x292 else set()
        message = self.messages.get(identifier)
        return {SIGNAL_NAMES[signal.name] for signal in message.signals if signal.name in SIGNAL_NAMES} if message else set()

    def decode(self, identifier: int, data: bytes) -> tuple[dict[str, float | None], dict[int, float | None]]:
        if identifier not in self.frame_ids:
            return {}, {}
        if self.database is None:
            return self._basic(identifier, data), {}
        message = self.messages[identifier]
        if len(data) != message.length:
            raise ValueError("Wrong CAN frame length")
        decoded = message.decode(data, decode_choices=False, allow_truncated=False)
        values = {}
        cells = {}
        for signal in message.signals:
            if signal.name not in decoded:
                continue
            value = decoded[signal.name]
            if signal.name in SIGNAL_NAMES:
                key = SIGNAL_NAMES[signal.name]
                factor = UNIT_FACTORS[key].get(signal.unit)
                if factor is None:
                    continue
                if key == "driveGear":
                    raw = signal.conversion.scaled_to_raw(value)
                    choice = str((signal.choices or {}).get(raw, ""))
                    values[key] = GEARS.get(choice)
                    continue
                valid = isinstance(value, (int, float)) and math.isfinite(value)
                if valid and signal.choices:
                    raw = signal.conversion.scaled_to_raw(value)
                    choice = str(signal.choices.get(raw, "")).upper()
                    valid = choice not in INVALID_CHOICES and not choice.endswith(("_SNA", "_INVALID"))
                values[key] = float(value) * factor if valid else None
            match = CELL_NAME.fullmatch(signal.name)
            if match is None:
                continue
            index = int(match.group(1))
            status = decoded.get(f"BMS_brickVoltageStatus{index}")
            factor = {"V": 1, "mV": 0.001}.get(signal.unit)
            cells[index] = (
                float(value) * factor
                if status == 2 and factor is not None and isinstance(value, (int, float)) and math.isfinite(value)
                else None
            )
        return values, cells

    @staticmethod
    def _basic(identifier: int, data: bytes) -> dict[str, float | None]:
        if len(data) != 8:
            raise ValueError("Wrong CAN frame length")
        if identifier == 0x132:
            voltage, current = struct.unpack_from("<Hh", data)
            return {"voltageV": voltage * 0.01, "currentA": current * 0.1}
        value = ((int.from_bytes(data, "little") >> 10) & 0x3FF) * 0.1
        return {"displayedChargePercent": value}
