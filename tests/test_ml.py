import numpy as np
import pytest

from ml.classifier import classify_expense
from ml.forecaster import forecast_next_month


def test_classifier():
    assert classify_expense("starbucks coffee") == "Food"
    assert classify_expense("apartment rent") == "Housing"
    assert classify_expense("electricity bill") == "Utilities"
    assert classify_expense("") == "General"


@pytest.mark.parametrize(
    "description",
    [
        "   ",
        "☕ café",
        "東京の電車",
        "unknown merchant xyz",
        "coffee " * 1000,
    ],
)
def test_classifier_unusual_descriptions(description):
    result = classify_expense(description)
    assert isinstance(result, str)
    assert result


def test_forecaster():
    history = [100.0, 110.0, 120.0]
    forecast = forecast_next_month(history)
    assert forecast > 120.0

    assert forecast_next_month([50.0]) == 50.0
    assert forecast_next_month([]) == 0.0


@pytest.mark.parametrize(
    "history",
    [
        [0.0, 0.0, 0.0],
        [-10.0, -20.0, -30.0],
        [100.0, 100.0, 100.0],
        [1e12, 2e12, 3e12],
    ],
)
def test_forecaster_unusual_values(history):
    result = forecast_next_month(history)
    assert isinstance(result, float)
    assert np.isfinite(result)
    assert result >= 0.0


def test_forecaster_negative_trend_never_returns_negative():
    result = forecast_next_month([100.0, 50.0, 10.0])
    assert result == 0.0


def test_forecaster_single_zero():
    assert forecast_next_month([0.0]) == 0.0

