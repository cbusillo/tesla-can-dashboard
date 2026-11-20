import importlib.util
from pathlib import Path
from types import ModuleType


def load_volume_flicker() -> ModuleType:
    source = Path(__file__).parents[1] / "extras" / "volume_flicker.py"
    spec = importlib.util.spec_from_file_location("volume_flicker", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load volume flicker helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_scroll_frame_preserves_fresh_native_switch_state() -> None:
    helper = load_volume_flicker()
    native_neutral = bytes.fromhex("2955000000000080")

    down = helper.build_scroll_frame(native_neutral, helper.SCROLL_DOWN)
    up = helper.build_scroll_frame(native_neutral, helper.SCROLL_UP)

    assert helper.SOCKETCAN_FRAME.unpack(down)[2] == bytes.fromhex("29553f0000000080")
    assert helper.SOCKETCAN_FRAME.unpack(up)[2] == bytes.fromhex("2955010000000080")


def test_native_neutral_requires_scroll_message_with_zero_ticks() -> None:
    helper = load_volume_flicker()
    neutral = helper.SOCKETCAN_FRAME.pack(helper.VOLUME_SWITCH_CAN_ID, 8, bytes.fromhex("2955000000000080"))
    down = helper.SOCKETCAN_FRAME.pack(helper.VOLUME_SWITCH_CAN_ID, 8, bytes.fromhex("29553f0000000080"))
    other = helper.SOCKETCAN_FRAME.pack(0x123, 8, bytes.fromhex("2955000000000080"))

    assert helper.extract_native_neutral(neutral) == bytes.fromhex("2955000000000080")
    assert helper.extract_native_neutral(down) is None
    assert helper.extract_native_neutral(other) is None
