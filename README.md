# Decentralized Budget Tracker

A privacy-first, local-first budget tracking application with an intelligent Python machine learning backend and a minimalist Vanilla JS frontend.

---

## Architecture

- **Frontend:** Pure Vanilla JS with IndexedDB for 100% private, browser-local data storage. Styled with a custom "Castle" dark aesthetic. Features a native CSS category breakdown chart.
- **Backend / ML Engine:** FastAPI monolith serving static assets and ML predictions. Uses **Scikit-Learn** (`RandomForestClassifier` for automated expense categorization and `LinearRegression` for spending forecasting).

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

Frontend budget logic (monthly limits, thresholds, export shape) is covered by
Node's built-in test runner — no dependencies needed:
```bash
node --test tests/budget_logic.test.js
```

---

## Setting monthly limits

Each category can have an optional monthly spending limit, stored privately in
your browser's IndexedDB (nothing leaves your device).

1. In the **Monthly Budgets** card, pick a category (or type a new one) and
   enter a limit greater than $0, then click **Save limit**.
   - Tip: the **Category Breakdown** chart also has a **Set limit** button on
     every category without a limit.
2. The breakdown shows `$spent / $limit (pct%)` for the current calendar
   month, with a progress bar:
   - Below 80%: green bar, `✓ On track`.
   - 80%–99%: amber bar, `⚠ Approaching limit`.
   - 100% and above: red bar, `⛔ Over budget`.
   - Status is always shown with an icon plus text, never color alone.
3. Limits reset automatically on the 1st of each month — only transactions
   dated in the current month count toward the bar.
4. Recording a transaction that pushes a category over its limit shows a
   dismissible warning banner at the top of the page.
5. **Edit** a limit via the Monthly Budgets list or the chart row; **Remove**
   it to return that category to the default share-of-total bar.
6. **Export data (JSON)** downloads transactions *and* limits together;
   **Import data** restores both (entries are merged, existing data is kept).

---

## Contributing

We welcome contributions! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to submit issues, propose features, and contribute code.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
