from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import List, Optional
from ml.classifier import classify_expense
from ml.forecaster import forecast_next_month, forecast_with_confidence
import json
import time
import urllib.request

app = FastAPI(title="Decentralized Budget Tracker")

# --- Free exchange rates (no API key) ---
# Primary: open.er-api.com (free, no key, daily). Fallback: Frankfurter (ECB, no key).
BASE_CURRENCY = "USD"
SUPPORTED_RATE_CODES = ("INR", "USD", "EUR", "GBP", "JPY")
_RATES_CACHE = {}  # base -> {"fetched_at": float, "payload": dict}
RATES_TTL_SECONDS = 12 * 3600


def _http_get_json(url: str, timeout: int = 10):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _rates_from_open_er_api(base: str):
    data = _http_get_json(f"https://open.er-api.com/v6/latest/{base}")
    if data.get("result") != "success":
        raise ValueError(f"open.er-api error: {data.get('result')}")
    rates = data.get("rates", {})
    out = {code: float(rates[code]) for code in SUPPORTED_RATE_CODES if code in rates}
    out[base] = 1.0
    if len(out) < len(SUPPORTED_RATE_CODES):
        raise ValueError("open.er-api missing currencies")
    return {"base": base, "date": data.get("time_last_update_utc", ""), "rates": out, "source": "open.er-api.com"}


def _rates_from_frankfurter(base: str):
    # Frankfurter v1 serves EUR base; convert to requested base via cross rates.
    data = _http_get_json("https://api.frankfurter.dev/v1/latest?base=EUR")
    eur_rates = data.get("rates", {})
    eur_rates["EUR"] = 1.0
    if base not in eur_rates:
        raise ValueError(f"Frankfurter missing base {base}")
    base_in_eur = float(eur_rates[base])
    out = {}
    for code in SUPPORTED_RATE_CODES:
        if code not in eur_rates:
            raise ValueError(f"Frankfurter missing {code}")
        out[code] = float(eur_rates[code]) / base_in_eur
    return {"base": base, "date": data.get("date", ""), "rates": out, "source": "frankfurter (ECB)"}


def get_rates(base: str):
    base = (base or BASE_CURRENCY).upper()
    if base not in SUPPORTED_RATE_CODES:
        base = BASE_CURRENCY
    now = time.time()
    cached = _RATES_CACHE.get(base)
    if cached and (now - cached["fetched_at"]) < RATES_TTL_SECONDS:
        return cached["payload"]
    last_error = None
    for fetcher in (_rates_from_open_er_api, _rates_from_frankfurter):
        try:
            payload = fetcher(base)
            _RATES_CACHE[base] = {"fetched_at": now, "payload": payload}
            return payload
        except Exception as e:
            last_error = e
    if cached:
        return cached["payload"]
    raise RuntimeError(f"exchange rates unavailable: {last_error}")

class ClassifyRequest(BaseModel):
    description: str

class ForecastRequest(BaseModel):
    history: List[float]

@app.post("/classify")
def classify(req: ClassifyRequest):
    category = classify_expense(req.description)
    return {"category": category}

@app.post("/forecast")
def forecast(req: ForecastRequest):
    return forecast_with_confidence(req.history)

@app.get("/rates")
def rates(base: str = Query(default="USD")):
    return get_rates(base)

@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")

app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
