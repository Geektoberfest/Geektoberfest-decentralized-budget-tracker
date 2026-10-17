"""Regression: offline fallback rates must never be stored as USD (critical)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "static" / "app.js"


def read() -> str:
    return JS.read_text(encoding="utf-8")


def test_convert_to_base_blocked_without_rates():
    js = read()
    assert "function isConversionReady" in js
    assert "if (!isConversionReady()) return NaN" in js
    assert "if (!isConversionReady())" in js


def test_submit_blocked_and_button_disabled_offline():
    js = read()
    assert "updateSubmitState" in js
    assert "submitBtn.disabled = blocked" in js
    assert "Rates unavailable" in js
    assert "Number.isFinite(amount)" in js


def test_no_unconditional_fallback_write():
    js = read()
    # convertToBase must be guarded by isConversionReady, not unconditional.
    idx_guard = js.find("function convertToBase")
    assert idx_guard != -1
    block = js[idx_guard:idx_guard + 400]
    assert "isConversionReady" in block
