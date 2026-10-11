const DB_NAME = "LedgerDB";
const DB_VERSION = 2;
const STORE_NAME = "transactions";
const BUDGET_STORE = "budgets";
let db = null;

const BL = (typeof window !== "undefined" && window.BudgetLogic) || null;

// Initialize IndexedDB (v2 adds the budgets store; v1 data is preserved)
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
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
            if (!database.objectStoreNames.contains(BUDGET_STORE)) {
                database.createObjectStore(BUDGET_STORE, { keyPath: "key" });
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

// Budget (monthly limit) Operations — stored locally in IndexedDB.
// Record shape: { key (normalized category), display, limit, updatedAt }
function normalizeKey(category) {
    if (BL) return BL.normalizeCategoryKey(category);
    return String(category || "").trim().toLowerCase();
}

function getBudgets() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BUDGET_STORE, "readonly");
        const store = transaction.objectStore(BUDGET_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function setBudget(category, limit) {
    const display = String(category || "").trim();
    const key = normalizeKey(display);
    const validLimit = BL ? BL.validateBudgetLimit(limit) : Number(limit);
    if (!key || validLimit === null || !(validLimit > 0)) {
        return Promise.reject(new Error("Provide a category and a limit greater than 0."));
    }
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BUDGET_STORE, "readwrite");
        const store = transaction.objectStore(BUDGET_STORE);
        const request = store.put({ key, display, limit: validLimit, updatedAt: new Date().toISOString() });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function deleteBudget(category) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BUDGET_STORE, "readwrite");
        const store = transaction.objectStore(BUDGET_STORE);
        const request = store.delete(normalizeKey(category));
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
const budgetAdviceEl = document.getElementById("budget-advice");
const expenseChartEl = document.getElementById("expense-chart");
const budgetAlertEl = document.getElementById("budget-alert");
const budgetAlertTextEl = document.getElementById("budget-alert-text");
const budgetAlertDismiss = document.getElementById("budget-alert-dismiss");
const budgetForm = document.getElementById("budget-form");
const budgetCategoryInput = document.getElementById("budget-category");
const budgetLimitInput = document.getElementById("budget-limit");
const budgetFormError = document.getElementById("budget-form-error");
const budgetListEl = document.getElementById("budget-list");
const budgetSubmitBtn = document.getElementById("budget-submit");
const budgetCancelBtn = document.getElementById("budget-cancel");
const categoryOptionsEl = document.getElementById("category-options");
const exportBtn = document.getElementById("export-btn");
const importInput = document.getElementById("import-input");

let classifyTimeout = null;
let editingBudgetKey = null;

const STATUS_META = {
    ok: { label: "On track", icon: "✓" },
    warning: { label: "Approaching limit", icon: "⚠" },
    over: { label: "Over budget", icon: "⛔" },
};

function showBudgetAlert(message) {
    budgetAlertTextEl.textContent = message;
    budgetAlertEl.hidden = false;
}

if (budgetAlertDismiss) {
    budgetAlertDismiss.addEventListener("click", () => {
        budgetAlertEl.hidden = true;
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
    const amount = parseFloat(amountInput.value);
    const category = categoryInput.value.trim() || "General";
    const date = new Date().toISOString();

    if (!description || isNaN(amount)) return;

    // Check whether this transaction pushes its category over its monthly limit.
    let overNotice = null;
    try {
        const [existingTxs, budgets] = await Promise.all([getTransactions(), getBudgets()]);
        const key = normalizeKey(category);
        const budget = budgets.find((b) => b.key === key);
        if (budget && BL) {
            const monthKey = BL.monthKeyForDate(new Date());
            const prevSpent = BL.sumSpentForCategory(existingTxs, key, monthKey);
            const nextSpent = prevSpent + amount;
            if (prevSpent <= budget.limit && nextSpent > budget.limit) {
                const overBy = nextSpent - budget.limit;
                overNotice = `Heads up: ${budget.display} is now $${overBy.toFixed(2)} over its $${budget.limit.toFixed(2)} monthly limit ($${nextSpent.toFixed(2)} spent).`;
            }
        }
    } catch (err) {
        console.error("Budget check error:", err);
    }

    await addTransaction({ description, amount, category, date });
    form.reset();
    categoryInput.value = "";
    await loadData();
    if (overNotice) showBudgetAlert(overNotice);
});

if (budgetForm) {
    budgetForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        budgetFormError.textContent = "";
        const category = budgetCategoryInput.value.trim();
        const limit = parseFloat(budgetLimitInput.value);
        try {
            await setBudget(category, limit);
            editingBudgetKey = null;
            budgetSubmitBtn.textContent = "Save limit";
            budgetCancelBtn.hidden = true;
            budgetForm.reset();
            await loadData();
        } catch (err) {
            budgetFormError.textContent = err.message || "Could not save limit.";
        }
    });
}

if (budgetCancelBtn) {
    budgetCancelBtn.addEventListener("click", () => {
        editingBudgetKey = null;
        budgetForm.reset();
        budgetFormError.textContent = "";
        budgetSubmitBtn.textContent = "Save limit";
        budgetCancelBtn.hidden = true;
    });
}

// Delegated actions for dynamically rendered budget buttons (avoids
// injecting raw category strings into inline onclick handlers).
document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-budget-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-budget-action");
    const key = btn.getAttribute("data-category-key");
    if (action === "remove") {
        await deleteBudget(key);
        if (editingBudgetKey === key) {
            editingBudgetKey = null;
            budgetForm.reset();
            budgetSubmitBtn.textContent = "Save limit";
            budgetCancelBtn.hidden = true;
        }
        await loadData();
    } else if (action === "edit" || action === "set") {
        const budgets = await getBudgets();
        const existing = budgets.find((b) => b.key === key);
        budgetCategoryInput.value = existing ? existing.display : (btn.getAttribute("data-category-display") || "");
        budgetLimitInput.value = existing ? existing.limit : "";
        editingBudgetKey = key;
        budgetSubmitBtn.textContent = existing ? "Update limit" : "Save limit";
        budgetCancelBtn.hidden = false;
        budgetCategoryInput.focus();
    }
});

if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
        const [txs, budgets] = await Promise.all([getTransactions(), getBudgets()]);
        const payload = BL.buildExportPayload(txs, budgets);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "budget-tracker-export.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
}

if (importInput) {
    importInput.addEventListener("change", async () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (Array.isArray(data.transactions)) {
                for (const tx of data.transactions) {
                    const amount = Number(tx.amount);
                    if (!tx.description || !Number.isFinite(amount)) continue;
                    await addTransaction({
                        description: String(tx.description),
                        amount,
                        category: tx.category ? String(tx.category) : "General",
                        date: tx.date || new Date().toISOString(),
                    });
                }
            }
            if (Array.isArray(data.budgets)) {
                for (const b of data.budgets) {
                    try {
                        await setBudget(b.category, b.limit);
                    } catch (err) {
                        console.warn("Skipping invalid budget entry:", b);
                    }
                }
            }
            await loadData();
        } catch (err) {
            console.error("Import error:", err);
            showBudgetAlert("Import failed: that file is not a valid budget-tracker export.");
        } finally {
            importInput.value = "";
        }
    });
}

async function removeTx(id) {
    await deleteTransaction(id);
    await loadData();
}

function renderBudgetList(budgets, monthSpending, monthKey) {
    if (!budgetListEl) return;
    if (budgets.length === 0) {
        budgetListEl.innerHTML = `<p class="empty-state">No monthly limits yet. Set one above to track spending against it.</p>`;
        return;
    }
    const sorted = [...budgets].sort((a, b) => a.display.localeCompare(b.display));
    budgetListEl.innerHTML = sorted.map((b) => {
        const spent = monthSpending[b.key] || 0;
        const status = BL.getBudgetStatus(spent, b.limit);
        const meta = STATUS_META[status.state] || STATUS_META.ok;
        return `
            <div class="budget-item">
                <div class="budget-item-info">
                    <span class="budget-item-cat">${escapeHtml(b.display)}</span>
                    <span class="budget-item-amounts">$${spent.toFixed(2)} / $${b.limit.toFixed(2)} this month</span>
                </div>
                <div class="budget-item-right">
                    <span class="budget-status status-${status.state}" role="status">${meta.icon} ${meta.label}</span>
                    <button class="btn-small" data-budget-action="edit" data-category-key="${escapeHtml(b.key)}">Edit</button>
                    <button class="btn-small btn-danger-ghost" data-budget-action="remove" data-category-key="${escapeHtml(b.key)}">Remove</button>
                </div>
            </div>
        `;
    }).join("");
}

async function loadData() {
    const [txs, budgets] = await Promise.all([getTransactions(), getBudgets()]);
    const currentMonthKey = BL.monthKeyForDate(new Date());
    const monthLabel = new Date().toLocaleString(undefined, { month: "long", year: "numeric" });

    // Render list
    if (txs.length === 0) {
        transactionList.innerHTML = `<p class="empty-state">No transactions recorded yet.</p>`;
    } else {
        transactionList.innerHTML = [...txs].reverse().map(tx => `
            <div class="transaction-item">
                <div class="tx-info">
                    <span class="tx-desc">${escapeHtml(tx.description)}</span>
                    <span class="tx-cat">${escapeHtml(tx.category)}</span>
                </div>
                <div class="tx-right">
                    <span class="tx-amount">$${tx.amount.toFixed(2)}</span>
                    <button class="btn-delete" onclick="removeTx(${tx.id})">&times;</button>
                </div>
            </div>
        `).join("");
    }

    // Calculate total spent (all time, unchanged behavior)
    const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
    totalSpentEl.textContent = `$${total.toFixed(2)}`;

    // All-time totals per category (legacy behavior for categories without a limit)
    const categoryMap = {};
    const displayName = {};
    txs.forEach(tx => {
        const raw = tx.category || "General";
        const key = normalizeKey(raw);
        categoryMap[key] = (categoryMap[key] || 0) + tx.amount;
        if (!displayName[key]) displayName[key] = raw;
    });

    // Current-month spending per category (basis for limit progress)
    const monthSpending = {};
    txs.forEach(tx => {
        if (!BL.isDateInMonth(tx.date, currentMonthKey)) return;
        const key = normalizeKey(tx.category || "General");
        const amt = Number(tx.amount);
        if (!Number.isFinite(amt)) return;
        monthSpending[key] = (monthSpending[key] || 0) + amt;
    });

    const budgetByKey = {};
    budgets.forEach((b) => {
        budgetByKey[b.key] = b;
        if (!displayName[b.key]) displayName[b.key] = b.display;
    });

    // Category suggestions for the budget form
    if (categoryOptionsEl) {
        const names = Object.keys(displayName).sort();
        categoryOptionsEl.innerHTML = names.map((k) => `<option value="${escapeHtml(displayName[k])}">`).join("");
    }

    renderBudgetList(budgets, monthSpending, currentMonthKey);

    // Render Category Breakdown Chart (native CSS bars — no chart library)
    const allKeys = [...new Set([...Object.keys(categoryMap), ...budgets.map((b) => b.key)])];
    if (allKeys.length === 0) {
        expenseChartEl.innerHTML = `<p class="empty-state">No data for chart yet.</p>`;
    } else {
        const rows = allKeys.map((key) => {
            const name = displayName[key] || key;
            const budget = budgetByKey[key];
            if (budget) {
                const spent = monthSpending[key] || 0;
                const status = BL.getBudgetStatus(spent, budget.limit);
                const meta = STATUS_META[status.state] || STATUS_META.ok;
                const width = Math.min(status.pct, 100);
                const stateClass = status.state === "ok" ? "" : ` is-${status.state}`;
                return {
                    sort: status.state === "over" ? 0 : status.state === "warning" ? 1 : 2,
                    amount: spent,
                    html: `
                <div class="chart-bar-row">
                    <div class="chart-bar-meta">
                        <span>${escapeHtml(name)} <span class="budget-status status-${status.state}" role="status">${meta.icon} ${meta.label}</span></span>
                        <span>$${spent.toFixed(2)} / $${budget.limit.toFixed(2)} (${status.pct.toFixed(0)}%) · ${escapeHtml(monthLabel)}</span>
                    </div>
                    <div class="chart-bar-track">
                        <div class="chart-bar-fill${stateClass}" style="width: ${width}%" role="progressbar" aria-valuenow="${status.pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(name)} spending versus monthly limit"></div>
                    </div>
                    <div class="chart-bar-actions">
                        <button class="btn-small" data-budget-action="edit" data-category-key="${escapeHtml(key)}">Edit limit</button>
                        <button class="btn-small btn-danger-ghost" data-budget-action="remove" data-category-key="${escapeHtml(key)}">Remove limit</button>
                    </div>
                </div>`,
                };
            }
            const amt = categoryMap[key] || 0;
            const pct = total > 0 ? (amt / total) * 100 : 0;
            return {
                sort: 3,
                amount: amt,
                html: `
                <div class="chart-bar-row">
                    <div class="chart-bar-meta">
                        <span>${escapeHtml(name)}</span>
                        <span>$${amt.toFixed(2)} (${pct.toFixed(0)}%)</span>
                    </div>
                    <div class="chart-bar-track">
                        <div class="chart-bar-fill" style="width: ${pct}%"></div>
                    </div>
                    <div class="chart-bar-actions">
                        <button class="btn-small" data-budget-action="set" data-category-key="${escapeHtml(key)}" data-category-display="${escapeHtml(name)}">Set limit</button>
                    </div>
                </div>`,
            };
        });

        rows.sort((a, b) => a.sort - b.sort || b.amount - a.amount);
        expenseChartEl.innerHTML = rows.map((r) => r.html).join("");
    }

    // Group by month for forecasting (mock grouping by index for simplicity)
    // In a real app, group by YYYY-MM
    if (txs.length > 0) {
        // Create dummy monthly history based on totals or entries
        const history = [total * 0.8, total * 0.9, total];
        try {
            const res = await fetch("/forecast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ history })
            });
            const data = await res.json();
            forecastSpentEl.textContent = `$${data.forecast.toFixed(2)}`;

            if (data.forecast > total * 1.2) {
                budgetAdviceEl.textContent = `💡 Suggestion: Spending is trending upward. Consider reducing discretionary categories like Entertainment and Shopping.`;
            } else {
                budgetAdviceEl.textContent = `✨ Suggestion: Your spending is stable and well-balanced. Keep it up!`;
            }
        } catch (err) {
            console.error("Forecast error:", err);
        }
    } else {
        forecastSpentEl.textContent = `$0.00`;
        budgetAdviceEl.textContent = `Add transactions to receive AI budget suggestions.`;
    }
}

function escapeHtml(str) {
    return String(str === null || str === undefined ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Initialize on load
initDB().then(() => {
    loadData();
}).catch(err => console.error("IndexedDB init failed:", err));
