# Decentralized Budget Tracker

A privacy-first, local-first budget tracking application with an intelligent Python machine learning backend and a minimalist Vanilla JS frontend.

---

## Architecture

- **Frontend:** Pure Vanilla JS with IndexedDB for 100% private, browser-local data storage. Styled with a custom "Castle" aesthetic supporting light and dark themes with a header toggle. Features a native CSS category breakdown chart.
- **Backend / ML Engine:** FastAPI monolith serving static assets and ML predictions. Uses **Scikit-Learn** (`RandomForestClassifier` for automated expense categorization and `LinearRegression` for spending forecasting).

---

## Currency Conversion

- Use the **Currency** dropdown in the header to choose from INR, USD, EUR, GBP or JPY.
- All amounts (transaction list, totals, chart labels, forecast) are **converted** from the USD base and formatted with `Intl.NumberFormat` (for example `100 USD` -> `~₹9,590`, `~¥15,850`). JPY shows with zero decimals automatically.
- Rates come from free no-key APIs: `GET /rates?base=USD` tries `open.er-api.com` first, then Frankfurter (ECB) via cross-rates, with 12h server cache + `localStorage` cache. Offline falls back to last cached or symbols-only.
- Entries typed in the display currency are normalized to USD for storage, so switching currency round-trips. Old data is treated as USD.
- The choice persists in `localStorage` (`ledger:currency`) across reloads.

## Spending Forecast & Confidence Indicator

- The spending forecast uses **Scikit-Learn** `LinearRegression` with an empirical prediction range and confidence rating.
- **Prediction Interval:** Computes the residual standard deviation \(s = \sqrt{\frac{\sum (y_i - \hat{y}_i)^2}{n - 2}}\) and estimates an approximate 95% interval \([\max(0, \hat{y} - 1.96s), \max(0, \hat{y} + 1.96s)]\).
- **Confidence Thresholds:**
  - **High:** \(\ge 3\) historical points and \(R^2 \ge 0.80\) (strong linear trend, low residual spread).
  - **Medium:** \(\ge 3\) historical points and \(0.50 \le R^2 < 0.80\) (moderate trend, noticeable variation).
  - **Low:** \(R^2 < 0.50\) (noisy or erratic data) or \(< 3\) historical points (insufficient data).
- **Insufficient Data Handling:** When fewer than 3 months of history exist, the API returns confidence `low` with `lower` and `upper` as `null` along with a clear explanatory message, preventing misleading intervals.
- **Frontend Display:** The UI renders the confidence level badge (`High`, `Medium`, `Low`) and the prediction range next to the forecast, automatically formatted in the active currency.

---

## Per-Category Budget Limits & Overspend Warnings

- **Setting Limits:** In the **Monthly Budget Limits** section, enter or select a category and input an optional monthly target amount in your active display currency, then click **Set Budget Limit**.
- **Managing Limits:** Users can add, edit, or remove limits for any category at any time. Active limits appear in the configured limits list with quick **Edit** and **Delete** controls.
- **Private Local Storage:** Budget limits are stored securely and privately in browser-local IndexedDB (`budget_limits` store) in canonical USD, allowing seamless currency switching and offline access.
- **Monthly Progress & Automatic Reset:** Progress is evaluated strictly per calendar month and resets at the start of every month.
- **Category Breakdown Integration:**
  - **On Track (< 80%):** Standard accent progress bar showing current monthly spending versus target limit.
  - **Warning State (80% – 99%):** Changes progress bar color to amber and renders a distinct `⚠️ Warning (X%)` badge.
  - **Over Budget (≥ 100%):** Changes progress bar color to red and renders a distinct `🚨 Over Budget (X%)` badge.
  - **Accessible Indicators:** Warning and over-budget states are visually distinct and never conveyed by color alone (pairing high-contrast badges, status text, and icons).
  - **Default Behavior:** Categories without a defined limit continue to display their proportion of total expenses as normal.
- **Overspend Alert Notifications:** When a newly recorded transaction pushes a category over its monthly limit, an interactive alert banner immediately appears detailing the category, new total spent, and amount exceeded.

---

## Getting Started

### Prerequisites
- Python 3.10+
- `pip`

### Installation & Execution

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/ledger-budget-tracker.git
   cd ledger-budget-tracker
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the application:
   ```bash
   python main.py
   ```

4. Open your browser at:
   ```text
   http://127.0.0.1:8000
   ```

---

## Running Tests

To run the test suite (unit tests for ML models and FastAPI endpoints):
```bash
python -m pytest -v
```

---

## Contributing

We welcome contributions! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to submit issues, propose features, and contribute code.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
