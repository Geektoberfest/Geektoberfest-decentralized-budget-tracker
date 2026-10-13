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

    /** Derive the CSV "type" column: negative amounts count as income. */
    function deriveType(tx) {
        return Number(tx && tx.amount) < 0 ? "income" : "expense";
    }

    /** Escape one CSV cell (quotes, commas, newlines). */
    function csvEscape(value) {
        const s = String(value === null || value === undefined ? "" : value);
        if (/[",\n\r]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    /**
     * Build spreadsheet CSV: header date,description,category,amount,type.
     * Transactions carry no type field, so it is derived from the amount.
     */
    function buildCsv(transactions) {
        const header = "date,description,category,amount,type";
        const rows = (transactions || []).map((tx) => [
            csvEscape(tx.date || ""),
            csvEscape(tx.description || ""),
            csvEscape(tx.category || "General"),
            csvEscape(tx.amount),
            csvEscape(deriveType(tx)),
        ].join(","));
        return [header, ...rows].join("\n");
    }

    /**
     * Validate an imported payload WITHOUT touching storage, so corrupt
     * files can be rejected before any write happens. Returns sanitized
     * { transactions, budgets } or throws an Error with a user-facing message.
     * Accepts our own export shape; budgets are optional (older exports).
     */
    function validateImportPayload(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Not a budget-tracker backup: expected a JSON object.");
        }
        if (!Array.isArray(data.transactions)) {
            throw new Error("Not a budget-tracker backup: missing transaction list.");
        }
        const transactions = data.transactions.map((tx, i) => {
            if (!tx || typeof tx !== "object") {
                throw new Error(`Transaction #${i + 1} is malformed.`);
            }
            const description = String(tx.description || "").trim();
            const amount = Number(tx.amount);
            if (!description) {
                throw new Error(`Transaction #${i + 1} has no description.`);
            }
            if (!Number.isFinite(amount)) {
                throw new Error(`Transaction "${description}" has an invalid amount.`);
            }
            let date = tx.date ? new Date(tx.date) : new Date();
            if (Number.isNaN(date.getTime())) date = new Date();
            return {
                description,
                amount,
                category: tx.category ? String(tx.category) : "General",
                date: date.toISOString(),
            };
        });
        const budgets = [];
        if (data.budgets !== undefined) {
            if (!Array.isArray(data.budgets)) {
                throw new Error("Budget list is malformed.");
            }
            data.budgets.forEach((b, i) => {
                const limit = validateBudgetLimit(b && b.limit);
                const category = b && b.category ? String(b.category).trim() : "";
                if (!category || limit === null) {
                    throw new Error(`Budget #${i + 1} has an invalid category or limit.`);
                }
                budgets.push({ category, limit });
            });
        }
        return { transactions, budgets };
    }

    /** Identity of a transaction for duplicate detection (IDs excluded). */
    function dedupeKey(tx) {
        const time = new Date(tx.date).getTime();
        return JSON.stringify([
            Number.isNaN(time) ? tx.date : time,
            String(tx.description).trim(),
            normalizeCategoryKey(tx.category || "General"),
            Number(tx.amount),
        ]);
    }

    /**
     * Filter incoming transactions down to those not already present.
     * Exact duplicates (same date, description, category, amount) are
     * skipped; comparison ignores auto-generated IDs and date formatting.
     */
    function dedupeNewTransactions(existing, incoming) {
        const seen = new Set((existing || []).map(dedupeKey));
        return (incoming || []).filter((tx) => {
            const key = dedupeKey(tx);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
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
        deriveType,
        csvEscape,
        buildCsv,
        validateImportPayload,
        dedupeNewTransactions,
    };
});
