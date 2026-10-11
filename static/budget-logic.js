/**
 * Pure budget-limit helpers shared by the browser UI (static/app.js)
 * and the Node test suite (tests/budget_logic.test.js).
 *
 * No DOM or IndexedDB access here — everything is a pure function so the
 * monthly-reset and threshold logic can be unit tested without a browser.
 *
 * Loaded as a classic script in index.html (exposes `window.BudgetLogic`)
 * and as a CommonJS module under Node (module.exports).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    root.BudgetLogic = api;
})(typeof self !== "undefined" ? self : this, function () {
    const WARN_RATIO = 0.8;

    /** Normalize a category name to its storage key (case-insensitive). */
    function normalizeCategoryKey(category) {
        return String(category === null || category === undefined ? "" : category).trim().toLowerCase();
    }

    /**
     * Validate a budget limit. Returns the rounded limit (> 0, 2 decimals)
     * or null when invalid.
     */
    function validateBudgetLimit(limit) {
        const n = typeof limit === "string" && limit.trim() === "" ? NaN : Number(limit);
        if (!Number.isFinite(n) || n <= 0) return null;
        return Math.round(n * 100) / 100;
    }

    /**
     * Classify spending against a limit.
     * Returns { ratio, pct, state } where state is one of
     * "ok" | "warning" | "over" | "none" (no usable limit).
     */
    function getBudgetStatus(spent, limit) {
        const l = Number(limit);
        if (!Number.isFinite(l) || l <= 0) {
            return { ratio: 0, pct: 0, state: "none" };
        }
        const s = Number(spent);
        const safeSpent = Number.isFinite(s) ? s : 0;
        const ratio = safeSpent / l;
        return {
            ratio,
            pct: ratio * 100,
            state: ratio >= 1 ? "over" : ratio >= WARN_RATIO ? "warning" : "ok",
        };
    }

    /** Local-timezone "YYYY-MM" key for a Date (monthly reset basis). */
    function monthKeyForDate(date) {
        const d = date instanceof Date ? date : new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}`;
    }

    /** True when an ISO date string falls inside the given "YYYY-MM" month. */
    function isDateInMonth(dateStr, monthKey) {
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return false;
        return monthKeyForDate(d) === monthKey;
    }

    /**
     * Sum spending for one normalized category key within a month.
     * Comparison is case-insensitive; unparseable amounts are ignored.
     */
    function sumSpentForCategory(transactions, categoryKey, monthKey) {
        const key = normalizeCategoryKey(categoryKey);
        if (!key || !monthKey) return 0;
        return (transactions || []).reduce((sum, tx) => {
            if (!tx || normalizeCategoryKey(tx.category || "General") !== key) return sum;
            if (!isDateInMonth(tx.date, monthKey)) return sum;
            const amt = Number(tx.amount);
            if (!Number.isFinite(amt)) return sum;
            return sum + amt;
        }, 0);
    }

    /**
     * Build the portable export payload (transactions + budgets) so limits
     * travel with data export (Issue 6). Pure function for testability.
     */
    function buildExportPayload(transactions, budgets) {
        return {
            app: "ledger-budget-tracker",
            version: 1,
            exportedAt: new Date().toISOString(),
            transactions: (transactions || []).map((tx) => ({
                description: tx.description,
                amount: tx.amount,
                category: tx.category,
                date: tx.date,
            })),
            budgets: (budgets || []).map((b) => ({
                category: b.display || b.category,
                limit: b.limit,
            })),
        };
    }

    return {
        WARN_RATIO,
        normalizeCategoryKey,
        validateBudgetLimit,
        getBudgetStatus,
        monthKeyForDate,
        isDateInMonth,
        sumSpentForCategory,
        buildExportPayload,
    };
});
