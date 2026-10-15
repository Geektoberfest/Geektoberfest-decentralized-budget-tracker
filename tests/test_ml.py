from ml.classifier import classify_expense
from ml.forecaster import forecast_next_month, forecast_with_confidence


def test_classifier():
    assert classify_expense("starbucks coffee") == "Food"
    assert classify_expense("apartment rent") == "Housing"
    assert classify_expense("electricity bill") == "Utilities"
    assert classify_expense("") == "General"


def test_forecaster():
    history = [100.0, 110.0, 120.0]
    forecast = forecast_next_month(history)
    assert forecast > 120.0

    assert forecast_next_month([50.0]) == 50.0
    assert forecast_next_month([]) == 0.0


def test_forecast_high_confidence():
    # Clean linear data with strong trend
    history = [100.0, 110.0, 120.0]
    result = forecast_with_confidence(history)
    assert result["confidence"] == "high"
    assert result["forecast"] == 130.0
    assert result["lower"] == 130.0
    assert result["upper"] == 130.0
    assert result["message"] is None


def test_forecast_medium_confidence():
    # Moderate variation with discernible upward slope
    history = [100.0, 140.0, 120.0, 160.0]
    result = forecast_with_confidence(history)
    assert result["confidence"] == "medium"
    assert result["forecast"] > 160.0
    assert result["lower"] < result["forecast"] < result["upper"]
    assert result["message"] is None


def test_forecast_low_confidence_noisy():
    # Erratic / noisy data points
    history = [100.0, 300.0, 50.0, 280.0, 90.0]
    result = forecast_with_confidence(history)
    assert result["confidence"] == "low"
    assert result["lower"] is not None
    assert result["upper"] is not None
    assert result["lower"] <= result["forecast"] <= result["upper"]
    assert result["message"] is None


def test_forecast_insufficient_data():
    # Empty history
    res_empty = forecast_with_confidence([])
    assert res_empty["confidence"] == "low"
    assert res_empty["forecast"] == 0.0
    assert res_empty["lower"] is None
    assert res_empty["upper"] is None
    assert "at least 3 months" in res_empty["message"].lower()

    # Single month
    res_single = forecast_with_confidence([50.0])
    assert res_single["confidence"] == "low"
    assert res_single["forecast"] == 50.0
    assert res_single["lower"] is None
    assert res_single["upper"] is None
    assert "at least 3 months" in res_single["message"].lower()

    # Two months
    res_two = forecast_with_confidence([50.0, 60.0])
    assert res_two["confidence"] == "low"
    assert res_two["lower"] is None
    assert res_two["upper"] is None
    assert "at least 3 months" in res_two["message"].lower()
