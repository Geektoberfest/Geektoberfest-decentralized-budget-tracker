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
const exportCsvBtn = document.getElementById("export-csv-btn");
const importInput = document.getElementById("import-input");
const importPendingEl = document.getElementById("import-pending");
const importSummaryEl = document.getElementById("import-summary");
const importConfirmBtn = document.getElementById("import-confirm");
const importCancelBtn = document.getElementById("import-cancel");
const importStatusEl = document.getElementById("import-status");

let pendingImport = null;

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Read a File with FileReader (vanilla JS, no new libraries). */
function readFileText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read that file."));
        reader.onload = () => resolve(reader.result);
        reader.readAsText(file);
    });
}

/**
 * Replace ALL local data atomically: one transaction across both stores,
 * so a failure aborts everything instead of leaving a half-written state.
 */
function replaceAllData(transactions, budgets) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME, BUDGET_STORE], "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Import was aborted."));
        const txStore = transaction.objectStore(STORE_NAME);
        const budgetStore = transaction.objectStore(BUDGET_STORE);
        txStore.clear();
        budgetStore.clear();
        const now = new Date().toISOString();
        transactions.forEach((tx) => txStore.add(tx));
        budgets.forEach((b) => budgetStore.put({
            key: normalizeKey(b.category),
            display: b.category,
            limit: b.limit,
            updatedAt: now,
        }));
    });
}

if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
        const [txs, budgets] = await Promise.all([getTransactions(), getBudgets()]);
        const payload = BL.buildExportPayload(txs, budgets);
        downloadFile(JSON.stringify(payload, null, 2), "budget-tracker-export.json", "application/json");
    });
}

if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", async () => {
        const txs = await getTransactions();
        downloadFile(BL.buildCsv(txs), "budget-tracker-export.csv", "text/csv");
    });
}

function clearPendingImport() {
    pendingImport = null;
    importInput.value = "";
    if (importPendingEl) importPendingEl.hidden = true;
    if (importStatusEl) importStatusEl.textContent = "";
}

if (importInput) {
    importInput.addEventListener("change", async () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        if (importStatusEl) importStatusEl.textContent = "";
        let parsed;
        try {
            parsed = JSON.parse(await readFileText(file));
        } catch (err) {
            console.error("Import read error:", err);
            showBudgetAlert("Import failed: that file is not valid JSON and none of your data was changed.");
            importInput.value = "";
            return;
        }
        // Validate EVERYTHING before touching IndexedDB: corrupt files
        // are rejected here, leaving existing data untouched.
        let validated;
        try {
            validated = BL.validateImportPayload(parsed);
        } catch (err) {
            console.error("Import validation error:", err);
            showBudgetAlert(`Import failed: ${err.message} None of your data was changed.`);
            importInput.value = "";
            return;
        }
        pendingImport = validated;
        if (importSummaryEl) {
            importSummaryEl.textContent = `File looks good: ${validated.transactions.length} transaction(s), ${validated.budgets.length} budget(s). Choose merge or replace, then confirm.`;
        }
        if (importPendingEl) importPendingEl.hidden = false;
    });
}

if (importCancelBtn) {
    importCancelBtn.addEventListener("click", clearPendingImport);
}

if (importConfirmBtn) {
    importConfirmBtn.addEventListener("click", async () => {
        if (!pendingImport) return;
        const mode = (document.querySelector('input[name="import-mode"]:checked') || {}).value || "merge";
        importConfirmBtn.disabled = true;
        try {
            if (mode === "replace") {
                await replaceAllData(pendingImport.transactions, pendingImport.budgets);
                if (importStatusEl) {
                    importStatusEl.textContent = `Replaced all data with ${pendingImport.transactions.length} transaction(s) and ${pendingImport.budgets.length} budget(s).`;
                }
            } else {
                const existing = await getTransactions();
                const fresh = BL.dedupeNewTransactions(existing, pendingImport.transactions);
                for (const tx of fresh) {
                    await addTransaction(tx);
                }
                for (const b of pendingImport.budgets) {
                    await setBudget(b.category, b.limit);
                }
                const skipped = pendingImport.transactions.length - fresh.length;
                if (importStatusEl) {
                    importStatusEl.textContent = `Merged: ${fresh.length} imported, ${skipped} exact duplicate(s) skipped, ${pendingImport.budgets.length} budget(s) applied.`;
                }
            }
            clearPendingImport();
            await loadData();
        } catch (err) {
            console.error("Import apply error:", err);
            showBudgetAlert("Import failed while saving. Your existing data was left unchanged.");
        } finally {
            importConfirmBtn.disabled = false;
        }
    });
}

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

