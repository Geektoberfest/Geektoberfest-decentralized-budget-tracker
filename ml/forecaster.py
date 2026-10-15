import numpy as np
from sklearn.linear_model import LinearRegression
from typing import List, Dict, Any, Optional

# Confidence level thresholds:
# - Insufficient data: len(history) < 3 -> confidence: "low", lower/upper: None
# - High confidence: len(history) >= 3 and R^2 >= 0.80
# - Medium confidence: len(history) >= 3 and 0.50 <= R^2 < 0.80
# - Low confidence: len(history) >= 3 and R^2 < 0.50
CONFIDENCE_HIGH_R2 = 0.80
CONFIDENCE_MEDIUM_R2 = 0.50
MIN_DATA_POINTS = 3


def forecast_with_confidence(monthly_totals: List[float]) -> Dict[str, Any]:
    """
    Forecast next month's spending with prediction range and confidence rating.

    Returns:
        dict: {
            "forecast": float,
            "lower": Optional[float],
            "upper": Optional[float],
            "confidence": str ("low", "medium", or "high"),
            "message": Optional[str]
        }

    Confidence evaluation criteria:
    - Insufficient data (< 3 points): Returns confidence 'low' with lower/upper as None
      and a clear message explaining that at least 3 months are required.
    - Sufficient data (>= 3 points):
        * Computes linear regression fit.
        * Residual standard deviation s = sqrt(RSS / (n - 2)).
        * Prediction range: [max(0, forecast - 1.96*s), max(0, forecast + 1.96*s)] (approx. 95% interval).
        * R^2 >= 0.80 -> 'high' confidence (clean linear trend, low residual spread).
        * 0.50 <= R^2 < 0.80 -> 'medium' confidence (moderate variation).
        * R^2 < 0.50 -> 'low' confidence (noisy or erratic data).
    """
    n = len(monthly_totals)

    if n == 0:
        return {
            "forecast": 0.0,
            "lower": None,
            "upper": None,
            "confidence": "low",
            "message": "Insufficient data: at least 3 months of history are required for a reliable forecast.",
        }

    if n < MIN_DATA_POINTS:
        # Fallback single-point or two-point forecast without misleading prediction bounds
        last_val = (
            float(monthly_totals[0])
            if n == 1
            else float(max(0.0, 2 * monthly_totals[1] - monthly_totals[0]))
        )
        return {
            "forecast": round(last_val, 2),
            "lower": None,
            "upper": None,
            "confidence": "low",
            "message": f"Insufficient data: {n} month(s) provided. At least 3 months of history are required for a reliable forecast.",
        }

    X = np.arange(n).reshape(-1, 1)
    y = np.array(monthly_totals, dtype=float)

    model = LinearRegression()
    model.fit(X, y)

    next_x = np.array([[n]])
    forecast_val = max(0.0, float(model.predict(next_x)[0]))

    # Residuals & 95% prediction interval (approx +/- 1.96 * residual standard deviation)
    y_pred = model.predict(X)
    residuals = y - y_pred
    rss = float(np.sum(residuals ** 2))
    dof = n - 2
    residual_std = np.sqrt(rss / dof) if dof > 0 else 0.0

    margin = 1.96 * residual_std
    lower_bound = max(0.0, forecast_val - margin)
    upper_bound = max(0.0, forecast_val + margin)

    # R^2 determination
    tss = float(np.sum((y - np.mean(y)) ** 2))
    if tss < 1e-9:
        # Constant spending across all periods -> exact fit
        r2 = 1.0
    else:
        r2 = max(0.0, 1.0 - (rss / tss))

    if r2 >= CONFIDENCE_HIGH_R2:
        confidence = "high"
    elif r2 >= CONFIDENCE_MEDIUM_R2:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "forecast": round(float(forecast_val), 2),
        "lower": round(float(lower_bound), 2),
        "upper": round(float(upper_bound), 2),
        "confidence": confidence,
        "message": None,
    }


def forecast_next_month(monthly_totals: List[float]) -> float:
    """Backward-compatible helper returning single forecast float."""
    result = forecast_with_confidence(monthly_totals)
    return float(result["forecast"])
