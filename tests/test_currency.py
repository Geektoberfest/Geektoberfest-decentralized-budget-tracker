"""Static checks for currency conversion display (Phase 2, free no-key rates)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "static" / "index.html"
JS = ROOT / "static" / "app.js"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_currency_dropdown_has_required_currencies():
    html = read(HTML)
    assert 'id="currency-select"' in html
    for code in ("INR", "USD", "EUR", "GBP", "JPY"):
        assert f'value="{code}"' in html, f"missing currency option {code}"


def test_conversion_note_present():
    html = read(HTML)
    assert "currency-note" in html
    assert 'id="rate-status"' in html
    lowered = html.lower()
    assert "convert" in lowered
    assert "stored in usd" in lowered


def test_formatter_uses_intl_numberformat():
    js = read(JS)
    assert "Intl.NumberFormat" in js
    assert "formatAmount" in js
    assert "SUPPORTED_CURRENCIES" in js
    assert "ledger:currency" in js
    # Zero-decimal handling: JPY must be supported and use locale-based formatting
    # (Intl auto-selects 0 fraction digits for JPY).
    assert "JPY" in js
    assert "ja-JP" in js


def test_all_render_sites_use_converted_formatter():
    js = read(JS)
    # No leftover hardcoded dollar formatting for amounts.
    assert "${tx.amount.toFixed" not in js
    assert "${total.toFixed" not in js
    assert "${amt.toFixed" not in js
    assert "${data.forecast.toFixed" not in js
    assert "formatBaseAmount(tx.amount)" in js
    assert "formatBaseAmount(total)" in js
    assert "formatBaseAmount(amt)" in js
    assert "formatBaseAmount(data.forecast)" in js
    assert "formatBaseAmount(0)" in js


def test_storage_normalized_to_usd_base():
    js = read(JS)
    # Entries typed in display currency are normalized to USD base for storage.
    assert "convertToBase(entered)" in js
    assert "convertFromBase" in js
    assert "BASE_CURRENCY" in js
    assert '"/rates?base=' in js or "/rates?base=" in js
    assert "await addTransaction({ description, amount, category, date" in js
    # Provenance stored for audit of rate used at write time.
    assert "rateUsed" in js
    assert "ratesSource" in js
    assert "localStorage.getItem" in js and "ledger:currency" in js
    # Amount label/step syncs with currency.
    assert "amount-label" in js
