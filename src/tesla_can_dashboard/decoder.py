import math
import re
import struct
from copy import copy
from pathlib import Path
from typing import NamedTuple

import cantools
from cantools.database.can import Message, Signal

from .signals import is_valid_signal

SIGNAL_NAMES = {
    "BMS_dcLinkVoltage": "voltageV",
    "BMS_packCurrent": "currentA",
    "BMS_maxDischargePower": "outputLimitKw",
    "BMS_maxRegenPower": "regenLimitKw",
    "BMS_socUI": "displayedChargePercent",
    "BMS_nominalFullPackEnergy": "fullPackEnergyKwh",
    "BMS_nominalEnergyRemaining": "remainingEnergyKwh",
    "BMS_minPackTemperature": "minimumTemperatureC",
    "BMS_maxPackTemperature": "maximumTemperatureC",
    "DI_vehicleSpeed": "speedKmh",
    "DI_gear": "driveGear",
    "PCS_chgInputPower": "chargingPowerKw",
    "UI_chargeTerminationPct": "chargeLimitPercent",
    "UI_hvacReqTempSetpointLeft": "driverTemperatureC",
    "UI_hvacReqTempSetpointRight": "passengerTemperatureC",
}
UNIT_FACTORS: dict[str, dict[str | None, float]] = {
    "voltageV": {"V": 1, "mV": 0.001},
    "currentA": {"A": 1, "mA": 0.001},
    "outputLimitKw": {"kW": 1, "W": 0.001},
    "regenLimitKw": {"kW": 1, "W": 0.001},
    "displayedChargePercent": {"%": 1},
    "fullPackEnergyKwh": {"kWh": 1, "KWh": 1, "Wh": 0.001},
    "remainingEnergyKwh": {"kWh": 1, "KWh": 1, "Wh": 0.001},
    "minimumTemperatureC": {"deg C": 1, "degC": 1, "DegC": 1, "°C": 1, "C": 1},
    "maximumTemperatureC": {"deg C": 1, "degC": 1, "DegC": 1, "°C": 1, "C": 1},
    "speedKmh": {"MPH": 1.609344, "mph": 1.609344, "kph": 1, "km/h": 1},
    "driveGear": {None: 1, "": 1},
    "chargingPowerKw": {"kW": 1, "W": 0.001},
    "chargeLimitPercent": {"%": 1},
    "driverTemperatureC": {"deg C": 1, "degC": 1, "DegC": 1, "°C": 1, "C": 1},
    "passengerTemperatureC": {"deg C": 1, "degC": 1, "DegC": 1, "°C": 1, "C": 1},
}
GEARS = {"DI_GEAR_P": 1, "DI_GEAR_R": 2, "DI_GEAR_N": 3, "DI_GEAR_D": 4}
CELL_NAME = re.compile(r"BMS_brickVoltage(\d+)$")
INVALID_CHOICES = {"SNA", "INVALID", "NOT_AVAILABLE"}


class MultiplexerHeader(NamedTuple):
    message: Message
    selector: str
    supported: frozenset[int]


class Decoder:
    def __init__(self, dbc: Path | None = None, *, discharge_current: str | None = None) -> None:
        if discharge_current not in {None, "positive", "negative"}:
            raise ValueError("Choose positive or negative discharge current")
        self.discharge_current = discharge_current
        database = None
        if dbc is not None:
            database = cantools.database.can.Database(strict=False)
            database.add_dbc_file(dbc)
        self.database = database
        self.messages: dict[int, Message] = (
            {}
            if self.database is None
            else {
                message.frame_id: message
                for message in self.database.messages
                if any(signal.name in SIGNAL_NAMES or CELL_NAME.fullmatch(signal.name) for signal in message.signals)
            }
        )
        self.frame_ids = set(self.messages) if self.database else {0x132, 0x292}
        self.multiplexer_headers: dict[int, MultiplexerHeader] = {}
        for identifier, message in self.messages.items():
            header = self._multiplexer_header(message)
            if header is not None:
                self.multiplexer_headers[identifier] = header

    def signal_keys(self, identifier: int) -> set[str]:
        if self.database is None:
            keys = {"voltageV", "currentA"} if identifier == 0x132 else {"displayedChargePercent"} if identifier == 0x292 else set()
            return self._power_keys(keys)
        message = self.messages.get(identifier)
        if message is None:
            return set()
        return self._power_keys(
            {
                SIGNAL_NAMES[signal.name]
                for signal in message.signals
                if signal.name in SIGNAL_NAMES and signal.unit in UNIT_FACTORS[SIGNAL_NAMES[signal.name]]
            }
        )

    @property
    def current_direction(self) -> str:
        return f"{self.discharge_current}-discharge" if self.discharge_current else "unqualified"

    def _power_keys(self, keys: set[str]) -> set[str]:
        return keys | {"batteryPowerKw"} if self.discharge_current and {"voltageV", "currentA"} <= keys else keys

    def _with_power(self, values: dict[str, float | None]) -> dict[str, float | None]:
        if self.discharge_current and {"voltageV", "currentA"} <= values.keys():
            voltage, current = values["voltageV"], values["currentA"]
            values["batteryPowerKw"] = (
                voltage * current / 1000 * (1 if self.discharge_current == "positive" else -1)
                if voltage is not None
                and current is not None
                and is_valid_signal("voltageV", voltage)
                and is_valid_signal("currentA", current)
                else None
            )
        return values

    def decode(self, identifier: int, data: bytes) -> tuple[dict[str, float | None], dict[int, float | None]]:
        if identifier not in self.frame_ids:
            return {}, {}
        if self.database is None:
            return self._with_power(self._basic(identifier, data)), {}
        message = self.messages[identifier]
        if len(data) != message.length:
            raise ValueError("Wrong CAN frame length")
        decoded = self._decode_message(message, data)
        values = {}
        cells = {}
        for signal in message.signals:
            if signal.name not in decoded:
                continue
            value = decoded[signal.name]
            number = self._available_number(signal, value)
            if signal.name in SIGNAL_NAMES:
                key = SIGNAL_NAMES[signal.name]
                factor = UNIT_FACTORS[key].get(signal.unit)
                if factor is None:
                    continue
                if key == "driveGear":
                    if number is None:
                        values[key] = None
                        continue
                    raw = int(signal.conversion.scaled_to_raw(number))
                    choice = str((signal.choices or {}).get(raw, ""))
                    values[key] = GEARS.get(choice)
                    continue
                values[key] = number * factor if number is not None else None
            match = CELL_NAME.fullmatch(signal.name)
            if match is None:
                continue
            index = int(match.group(1))
            status = decoded.get(f"BMS_brickVoltageStatus{index}")
            factor = UNIT_FACTORS["voltageV"].get(signal.unit)
            cells[index] = number * factor if status == 2 and factor is not None and number is not None else None
        return self._with_power(values), cells

    @staticmethod
    def _multiplexer_header(message: Message) -> MultiplexerHeader | None:
        selectors = [signal for signal in message.signals if signal.is_multiplexer]
        if len(selectors) != 1 or selectors[0].multiplexer_signal is not None:
            return None
        selector = selectors[0]
        roots = [copy(signal) for signal in message.signals if signal.multiplexer_signal is None]
        for signal in roots:
            signal.is_multiplexer = False
        supported = frozenset(identifier for signal in message.signals for identifier in signal.multiplexer_ids or []) | frozenset(
            (selector.choices or {}).keys()
        )
        header = Message(
            message.frame_id, message.name, message.length, roots, is_extended_frame=message.is_extended_frame, strict=False
        )
        return MultiplexerHeader(header, selector.name, supported)

    def _decode_message(self, message: Message, data: bytes) -> dict:
        try:
            return message.decode_simple(data, decode_choices=False)
        except cantools.database.errors.DecodeError:
            header = self.multiplexer_headers.get(message.frame_id)
            if header is None:
                raise
            roots = header.message.decode_simple(data, decode_choices=False)
            selected = roots[header.selector]
            if not isinstance(selected, int) or selected in header.supported:
                raise
            return roots

    @staticmethod
    def _available_number(signal: Signal, value: object) -> float | None:
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            return None
        if signal.minimum is not None and signal.maximum is not None and signal.minimum < signal.maximum:
            if not signal.minimum <= value <= signal.maximum:
                return None
        choices = signal.choices
        if not choices:
            return float(value)
        raw = int(signal.conversion.scaled_to_raw(value))
        choice = str(choices.get(raw, "")).upper()
        return None if choice in INVALID_CHOICES or choice.endswith(("_SNA", "_INVALID")) else float(value)

    @staticmethod
    def _basic(identifier: int, data: bytes) -> dict[str, float | None]:
        if len(data) != 8:
            raise ValueError("Wrong CAN frame length")
        if identifier == 0x132:
            voltage, current = struct.unpack_from("<Hh", data)
            return {"voltageV": voltage * 0.01, "currentA": current * 0.1}
        value = ((int.from_bytes(data, "little") >> 10) & 0x3FF) * 0.1
        return {"displayedChargePercent": value}
