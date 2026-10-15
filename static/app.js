const DB_NAME = "LedgerDB";
const STORE_NAME = "transactions";
let db = null;

// --- Currency settings with real conversion (free no-key rates) ---
// Stored numbers are canonical USD (BASE_CURRENCY). Display converts via /rates.
const SUPPORTED_CURRENCIES = {
    INR: { locale: "en-IN", label: "INR (₹) — India" },
    USD: { locale: "en-US", label: "USD ($) — United States" },
    EUR: { locale: "en-IE", label: "EUR (€) — Eurozone" },
    GBP: { locale: "en-GB", label: "GBP (£) — United Kingdom" },
    JPY: { locale: "ja-JP", label: "JPY (¥) — Japan" },
};
const CURRENCY_STORAGE_KEY = "ledger:currency";
const RATES_STORAGE_PREFIX = "ledger:rates:";
const BASE_CURRENCY = "USD";
const RATES_TTL_MS = 12 * 3600 * 1000;
let activeCurrency = "USD";
let rateTable = { INR: 83, USD: 1, EUR: 0.92, GBP: 0.79, JPY: 150 };
let ratesSource = "";
let ratesReady = false;

function getSavedCurrency() {
    try {
        const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
        if (saved && SUPPORTED_CURRENCIES[saved]) return saved;
    } catch (e) {
        // Storage unavailable (private mode); fall through to default.
    }
    return "USD";
}

function saveCurrency(code) {
    try {
        localStorage.setItem(CURRENCY_STORAGE_KEY, code);
    } catch (e) {
        // Storage disabled or blocked; setting still applies for this session.
    }
}

// Format a target-currency amount for display.
// Intl.NumberFormat handles symbols, grouping (e.g. ₹1,00,000 vs $100,000)
// and zero-decimal currencies like JPY automatically.
function formatAmount(value) {
    const num = Number(value);
    const safe = Number.isFinite(num) ? num : 0;
    const code = SUPPORTED_CURRENCIES[activeCurrency] ? activeCurrency : "USD";
    const locale = SUPPORTED_CURRENCIES[code].locale;
    try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(safe);
    } catch (e) {
        return `${code} ${safe.toFixed(2)}`;
    }
}

function getRate(code) {
    const r = Number(rateTable[code]);
    return Number.isFinite(r) && r > 0 ? r : 1;
}

// Stored amounts are USD; convert to display currency.
function convertFromBase(baseAmount) {
    return Number(baseAmount) * getRate(activeCurrency);
}

// Display-currency input -> canonical USD for storage.
// Never guess with fallback rates. Returns NaN when no live/cached rates are
// available for a non-USD currency so the submit handler blocks the write
// instead of storing a permanently wrong USD value.
function isConversionReady() {
    if (activeCurrency === BASE_CURRENCY) return true;
    return ratesReady;
}

function convertToBase(displayAmount) {
    if (!isConversionReady()) return NaN;
    return Number(displayAmount) / getRate(activeCurrency);
}

function formatBaseAmount(baseAmount) {
    return formatAmount(convertFromBase(baseAmount));
}

// One corrupt IndexedDB row must not poison totals/charts to NaN.
function finiteAmount(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function getCachedRates() {
    try {
        const raw = localStorage.getItem(RATES_STORAGE_PREFIX + BASE_CURRENCY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.rates || !parsed.fetchedAt) return null;
        if (Date.now() - parsed.fetchedAt > RATES_TTL_MS) return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

function saveRatesCache(payload) {
    try {
        localStorage.setItem(RATES_STORAGE_PREFIX + BASE_CURRENCY, JSON.stringify({
            rates: payload.rates,
            source: payload.source,
            date: payload.date,
            fetchedAt: Date.now(),
        }));
    } catch (e) {
        // Cache is best-effort.
    }
}

async function fetchRates() {
    const cached = getCachedRates();
    if (cached) {
        rateTable = { ...rateTable, ...cached.rates };
        ratesSource = cached.source || "cache";
        ratesReady = true;
        updateRateStatus();
        // Refresh in background if older than 1h, but render now.
        if (Date.now() - cached.fetchedAt < 3600 * 1000) return rateTable;
    }
    try {
        const res = await fetch(`/rates?base=${BASE_CURRENCY}`);
        if (!res.ok) throw new Error(`rates HTTP ${res.status}`);
        const data = await res.json();
        if (!data.rates) throw new Error("bad rates payload");
        rateTable = { ...rateTable, ...data.rates };
        ratesSource = data.source || "live";
        ratesReady = true;
        saveRatesCache(data);
    } catch (err) {
        console.warn("Rates unavailable, using fallback symbols-only:", err);
        ratesSource = cached ? "cache (offline)" : "fallback (offline)";
        ratesReady = Boolean(cached);
    }
    updateRateStatus();
    return rateTable;
}

function updateRateStatus() {
    const el = document.getElementById("rate-status");
    if (el) {
        if (!isConversionReady()) {
            el.textContent = `Rates unavailable — amounts in ${activeCurrency} cannot be stored accurately while offline. Connect to refresh rates. Stored in USD.`;
        } else if (activeCurrency === BASE_CURRENCY) {
            el.textContent = ratesSource
                ? `Base USD • rates via ${ratesSource}.`
                : `Base USD.`;
        } else {
            const rate = getRate(activeCurrency);
            const example = formatBaseAmount(100);
            el.textContent = `1 ${BASE_CURRENCY} = ${rate} ${activeCurrency} • 100 ${BASE_CURRENCY} = ${example} • via ${ratesSource || "fallback"}. Stored in USD.`;
        }
    }
    updateSubmitState();
}

function updateSubmitState() {
    const formEl = document.getElementById("transaction-form");
    const submitBtn = (formEl && typeof formEl.querySelector === "function")
        ? formEl.querySelector('[type="submit"]')
        : null;
    if (!submitBtn) return;
    const blocked = typeof isConversionReady === "function" ? !isConversionReady() : false;
    submitBtn.disabled = blocked;
    submitBtn.title = blocked
        ? `Rates unavailable — connect to record ${activeCurrency} amounts accurately.`
        : "";
}

// Initialize IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            }
        };
    });
}

// DB Operations
function addTransaction(tx) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(tx);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getTransactions() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteTransaction(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// UI & ML Integration
const descInput = document.getElementById("description");
const amountInput = document.getElementById("amount");
const categoryInput = document.getElementById("category");
const form = document.getElementById("transaction-form");
const transactionList = document.getElementById("transaction-list");
const totalSpentEl = document.getElementById("total-spent");
const forecastSpentEl = document.getElementById("forecast-spent");
const forecastRangeEl = document.getElementById("forecast-range");
const forecastConfidenceEl = document.getElementById("forecast-confidence");
const budgetAdviceEl = document.getElementById("budget-advice");
const expenseChartEl = document.getElementById("expense-chart");

// Filter UI Elements
const searchFilterInput = document.getElementById("search-filter");
const categoryFilterSelect = document.getElementById("category-filter");
const monthFilterSelect = document.getElementById("month-filter");
const dateFromInput = document.getElementById("filter-date-from");
const dateToInput = document.getElementById("filter-date-to");
const clearFiltersBtn = document.getElementById("clear-filters-btn");
const filterCountEl = document.getElementById("filter-count");

let classifyTimeout = null;
let searchDebounceTimeout = null;
let allTransactions = [];
let activeFilters = {
    search: "",
    category: "",
    month: "",
    dateFrom: "",
    dateTo: ""
};

/**
 * Filter transactions based on combined criteria:
 * - search: case-insensitive match on description and category
 * - category: exact category match
 * - month: "YYYY-MM" matching the transaction date
 * - dateFrom / dateTo: inclusive date boundary filtering
 */
function filterTransactions(transactions, filters = {}) {
    if (!Array.isArray(transactions)) return [];
    const searchLower = (filters.search || "").trim().toLowerCase();
    const catFilter = (filters.category || "").trim().toLowerCase();
    const monthFilter = (filters.month || "").trim();
    const fromTime = filters.dateFrom ? new Date(filters.dateFrom + "T00:00:00").getTime() : null;
    const toTime = filters.dateTo ? new Date(filters.dateTo + "T23:59:59.999").getTime() : null;

    return transactions.filter(tx => {
        if (!tx) return false;

        // Search text matching description and category (case-insensitive)
        if (searchLower) {
            const desc = (tx.description || "").toLowerCase();
            const cat = (tx.category || "").toLowerCase();
            if (!desc.includes(searchLower) && !cat.includes(searchLower)) {
                return false;
            }
        }

        // Category filter
        if (catFilter) {
            const cat = (tx.category || "").toLowerCase();
            if (cat !== catFilter) {
                return false;
            }
        }

        // Month filter ("YYYY-MM")
        if (monthFilter) {
            const txMonth = (tx.date || "").slice(0, 7);
            if (txMonth !== monthFilter) {
                return false;
            }
        }

        // Date range
        if (fromTime !== null || toTime !== null) {
            if (!tx.date) return false;
            const txTime = new Date(tx.date).getTime();
            if (isNaN(txTime)) return false;
            if (fromTime !== null && txTime < fromTime) return false;
            if (toTime !== null && txTime > toTime) return false;
        }

        return true;
    });
}

descInput.addEventListener("input", () => {
    clearTimeout(classifyTimeout);
    const desc = descInput.value.trim();
    if (!desc) {
        categoryInput.value = "";
        return;
    }
    classifyTimeout = setTimeout(async () => {
        try {
            const res = await fetch("/classify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: desc })
            });
            const data = await res.json();
            if (data.category) {
                categoryInput.value = data.category;
            }
        } catch (err) {
            console.error("Classification error:", err);
        }
    }, 300);
});

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const description = descInput.value.trim();
    const entered = parseFloat(amountInput.value);
    const category = categoryInput.value.trim() || "General";
    const date = new Date().toISOString();

    if (!description || isNaN(entered)) return;

    // Block non-USD writes while rates are unavailable (no live/cached rates).
    // convertToBase returns NaN in that state; never store a fallback guess.
    if (!isConversionReady()) {
        updateRateStatus();
        return;
    }

    // Entered in display currency -> normalize to USD base for storage.
    const amount = convertToBase(entered);
    if (!Number.isFinite(amount)) return;

    // Store provenance so rate used at write time can be audited later.
    await addTransaction({ description, amount, category, date, currency: activeCurrency, rateUsed: getRate(activeCurrency), ratesSource });
    form.reset();
    categoryInput.value = "";
    await loadData();
});

async function removeTx(id) {
    await deleteTransaction(id);
    await loadData();
}

function updateFilterDropdownOptions() {
    if (!categoryFilterSelect || !monthFilterSelect) return;

    // Category options
    const currentCat = activeFilters.category;
    const categories = Array.from(new Set(allTransactions.map(t => (t.category || "General").trim()))).sort();
    categoryFilterSelect.innerHTML = `<option value="">All Categories</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (categories.includes(currentCat)) {
        categoryFilterSelect.value = currentCat;
    } else {
        activeFilters.category = "";
        categoryFilterSelect.value = "";
    }

    // Month options (e.g., "October 2026")
    const currentMonth = activeFilters.month;
    const months = Array.from(new Set(
        allTransactions
            .map(t => (t.date || "").slice(0, 7))
            .filter(m => /^\d{4}-\d{2}$/.test(m))
    )).sort().reverse();

    monthFilterSelect.innerHTML = `<option value="">All Months</option>` +
        months.map(m => {
            const [y, mon] = m.split("-");
            const dateObj = new Date(parseInt(y, 10), parseInt(mon, 10) - 1, 1);
            const label = isNaN(dateObj.getTime())
                ? m
                : dateObj.toLocaleString("en-US", { month: "long", year: "numeric" });
            return `<option value="${m}">${label}</option>`;
        }).join("");

    if (months.includes(currentMonth)) {
        monthFilterSelect.value = currentMonth;
    } else {
        activeFilters.month = "";
        monthFilterSelect.value = "";
    }
}

async function renderFilteredView() {
    const filtered = filterTransactions(allTransactions, activeFilters);
    const hasActiveFilters = Boolean(
        activeFilters.search ||
        activeFilters.category ||
        activeFilters.month ||
        activeFilters.dateFrom ||
        activeFilters.dateTo
    );

    // Update filter count badge
    if (filterCountEl) {
        if (allTransactions.length === 0) {
            filterCountEl.textContent = "";
        } else if (hasActiveFilters) {
            filterCountEl.textContent = `Showing ${filtered.length} of ${allTransactions.length}`;
        } else {
            filterCountEl.textContent = `${allTransactions.length} transaction${allTransactions.length === 1 ? "" : "s"}`;
        }
    }

    // Render list (stored USD -> display currency)
    if (allTransactions.length === 0) {
        transactionList.innerHTML = `<p class="empty-state">No transactions recorded yet.</p>`;
    } else if (filtered.length === 0) {
        transactionList.innerHTML = `<p class="empty-state">No transactions found matching your filters.</p>`;
    } else {
        transactionList.innerHTML = [...filtered].reverse().map(tx => `
            <div class="transaction-item">
                <div class="tx-info">
                    <span class="tx-desc">${escapeHtml(tx.description)}</span>
                    <span class="tx-cat">${escapeHtml(tx.category)}</span>
                </div>
                <div class="tx-right">
                    <span class="tx-amount">${formatBaseAmount(tx.amount)}</span>
                    <button class="btn-delete" onclick="removeTx(${tx.id})">&times;</button>
                </div>
            </div>
        `).join("");
    }

    // Calculate total spent (in USD base, converted for display).
    const total = filtered.reduce((sum, tx) => sum + finiteAmount(tx.amount), 0);
    totalSpentEl.textContent = formatBaseAmount(total);

    // Render Category Breakdown Chart
    if (filtered.length === 0) {
        expenseChartEl.innerHTML = `<p class="empty-state">No data for chart yet.</p>`;
    } else {
        const categoryMap = {};
        filtered.forEach(tx => {
            const cat = tx.category || "General";
            categoryMap[cat] = (categoryMap[cat] || 0) + finiteAmount(tx.amount);
        });

        expenseChartEl.innerHTML = Object.entries(categoryMap).map(([cat, amt]) => {
            const pct = total > 0 ? (amt / total) * 100 : 0;
            return `
                <div class="chart-bar-row">
                    <div class="chart-bar-meta">
                        <span>${escapeHtml(cat)}</span>
                        <span>${formatBaseAmount(amt)} (${pct.toFixed(0)}%)</span>
                    </div>
                    <div class="chart-bar-track">
                        <div class="chart-bar-fill" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join("");
    }

    // Forecast calculation
    if (filtered.length > 0) {
        const monthMap = {};
        filtered.forEach(tx => {
            const m = (tx.date || "").slice(0, 7);
            if (m) monthMap[m] = (monthMap[m] || 0) + finiteAmount(tx.amount);
        });
        const monthKeys = Object.keys(monthMap).sort();
        let history;
        if (monthKeys.length >= 3) {
            history = monthKeys.map(k => monthMap[k]);
        } else if (filtered.length < 3) {
            history = filtered.map(t => finiteAmount(t.amount));
        } else {
            const chunkSize = Math.ceil(filtered.length / 3);
            history = [
                filtered.slice(0, chunkSize).reduce((s, t) => s + finiteAmount(t.amount), 0),
                filtered.slice(chunkSize, chunkSize * 2).reduce((s, t) => s + finiteAmount(t.amount), 0),
                filtered.slice(chunkSize * 2).reduce((s, t) => s + finiteAmount(t.amount), 0)
            ];
        }

        try {
            const res = await fetch("/forecast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ history })
            });
            const data = await res.json();
            forecastSpentEl.textContent = formatBaseAmount(data.forecast);

            if (forecastConfidenceEl) {
                const conf = (data.confidence || "low").toLowerCase();
                const label = conf.charAt(0).toUpperCase() + conf.slice(1);
                forecastConfidenceEl.textContent = label;
                forecastConfidenceEl.className = `confidence-badge confidence-${conf}`;
                forecastConfidenceEl.title = data.message || `Confidence: ${label}`;
            }

            if (forecastRangeEl) {
                if (data.lower !== null && data.lower !== undefined && data.upper !== null && data.upper !== undefined) {
                    forecastRangeEl.textContent = `Range: ${formatBaseAmount(data.lower)} – ${formatBaseAmount(data.upper)}`;
                    forecastRangeEl.title = "95% prediction interval (±1.96σ)";
                } else if (data.message) {
                    forecastRangeEl.textContent = "Range: N/A (need ≥3 months)";
                    forecastRangeEl.title = data.message;
                } else {
                    forecastRangeEl.textContent = "Range: N/A";
                }
            }

            if (data.forecast > total * 1.2) {
                budgetAdviceEl.textContent = `💡 Suggestion: Spending is trending upward. Consider reducing discretionary categories like Entertainment and Shopping.`;
            } else {
                budgetAdviceEl.textContent = `✨ Suggestion: Your spending is stable and well-balanced. Keep it up!`;
            }
        } catch (err) {
            console.error("Forecast error:", err);
            if (forecastConfidenceEl) {
                forecastConfidenceEl.textContent = "Error";
                forecastConfidenceEl.className = "confidence-badge confidence-none";
            }
            if (forecastRangeEl) {
                forecastRangeEl.textContent = "Range: Unavailable";
            }
        }
    } else {
        forecastSpentEl.textContent = formatBaseAmount(0);
        if (forecastConfidenceEl) {
            forecastConfidenceEl.textContent = "—";
            forecastConfidenceEl.className = "confidence-badge confidence-none";
            forecastConfidenceEl.title = "No transactions recorded yet";
        }
        if (forecastRangeEl) {
            forecastRangeEl.textContent = "Range: —";
            forecastRangeEl.title = "";
        }
        budgetAdviceEl.textContent = `Add transactions to receive AI budget suggestions.`;
    }
}

async function loadData() {
    await fetchRates();
    allTransactions = await getTransactions();
    updateFilterDropdownOptions();
    await renderFilteredView();
}

// Bind filter event listeners
if (searchFilterInput) {
    searchFilterInput.addEventListener("input", () => {
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
            activeFilters.search = searchFilterInput.value;
            renderFilteredView();
        }, 250);
    });
}

if (categoryFilterSelect) {
    categoryFilterSelect.addEventListener("change", () => {
        activeFilters.category = categoryFilterSelect.value;
        renderFilteredView();
    });
}

if (monthFilterSelect) {
    monthFilterSelect.addEventListener("change", () => {
        activeFilters.month = monthFilterSelect.value;
        // If a month is chosen and custom dates contradict, clear custom dates for clarity
        if (monthFilterSelect.value) {
            if (dateFromInput) dateFromInput.value = "";
            if (dateToInput) dateToInput.value = "";
            activeFilters.dateFrom = "";
            activeFilters.dateTo = "";
        }
        renderFilteredView();
    });
}

if (dateFromInput) {
    dateFromInput.addEventListener("change", () => {
        activeFilters.dateFrom = dateFromInput.value;
        if (dateFromInput.value && monthFilterSelect) {
            monthFilterSelect.value = "";
            activeFilters.month = "";
        }
        renderFilteredView();
    });
}

if (dateToInput) {
    dateToInput.addEventListener("change", () => {
        activeFilters.dateTo = dateToInput.value;
        if (dateToInput.value && monthFilterSelect) {
            monthFilterSelect.value = "";
            activeFilters.month = "";
        }
        renderFilteredView();
    });
}

if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
        activeFilters = {
            search: "",
            category: "",
            month: "",
            dateFrom: "",
            dateTo: ""
        };
        if (searchFilterInput) searchFilterInput.value = "";
        if (categoryFilterSelect) categoryFilterSelect.value = "";
        if (monthFilterSelect) monthFilterSelect.value = "";
        if (dateFromInput) dateFromInput.value = "";
        if (dateToInput) dateToInput.value = "";
        renderFilteredView();
    });
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Initialize on load
function syncCurrencyUI() {
    const select = document.getElementById("currency-select");
    if (select && select.value !== activeCurrency) {
        select.value = activeCurrency;
    }
    const amountLabel = document.getElementById("amount-label");
    if (amountLabel) {
        amountLabel.textContent = `Amount (${activeCurrency})`;
    }
    // Zero-decimal currencies (e.g. JPY) should not suggest cents.
    if (amountInput) {
        const isZeroDecimal = activeCurrency === "JPY";
        amountInput.step = isZeroDecimal ? "1" : "0.01";
        amountInput.placeholder = isZeroDecimal ? "0" : "0.00";
    }
    updateRateStatus();
}

async function applyCurrency(code, options = {}) {
    const { persist = true, rerender = true } = options;
    if (!SUPPORTED_CURRENCIES[code]) return;
    activeCurrency = code;
    if (persist) saveCurrency(code);
    syncCurrencyUI();
    if (rerender) await loadData();
}

activeCurrency = getSavedCurrency();

const currencySelect = document.getElementById("currency-select");
if (currencySelect) {
    currencySelect.value = activeCurrency;
    currencySelect.addEventListener("change", (e) => {
        applyCurrency(e.target.value);
    });
}
syncCurrencyUI();

initDB().then(() => {
    // Re-sync after DOM init so totals/chart/list use saved currency.
    syncCurrencyUI();
    loadData();
}).catch(err => console.error("IndexedDB init failed:", err));

// Theme Toggle & OS Preference
function getSavedTheme() {
    try {
        return localStorage.getItem("theme");
    } catch (e) {
        return null;
    }
}

function saveTheme(theme) {
    try {
        localStorage.setItem("theme", theme);
    } catch (e) {
        // Storage disabled or blocked
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const toggleBtn = document.getElementById("theme-toggle");
    if (toggleBtn) {
        const isLight = theme === "light";
        toggleBtn.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
        toggleBtn.setAttribute("aria-pressed", isLight ? "true" : "false");
    }
}

const themeToggleBtn = document.getElementById("theme-toggle");
if (themeToggleBtn) {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(currentTheme);

    themeToggleBtn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
        const next = current === "light" ? "dark" : "light";
        saveTheme(next);
        applyTheme(next);
    });
}

const systemThemeMedia = window.matchMedia("(prefers-color-scheme: light)");
const onSystemThemeChange = (e) => {
    if (!getSavedTheme()) {
        applyTheme(e.matches ? "light" : "dark");
    }
};

if (systemThemeMedia.addEventListener) {
    systemThemeMedia.addEventListener("change", onSystemThemeChange);
} else if (systemThemeMedia.addListener) {
    systemThemeMedia.addListener(onSystemThemeChange);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        filterTransactions
    };
}
