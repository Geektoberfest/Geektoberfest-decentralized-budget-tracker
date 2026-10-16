const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Load app.js in a safe sandbox mock environment
const appJsPath = path.join(__dirname, "../static/app.js");
const appJsCode = fs.readFileSync(appJsPath, "utf-8");

const mockElement = () => ({
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => mockElement(),
    scrollIntoView: () => {},
    focus: () => {},
    innerHTML: "",
    textContent: "",
    value: "",
    style: {},
    className: ""
});

const mockDB = {
    transaction: () => ({
        objectStore: () => ({
            add: () => ({ onsuccess: null, onerror: null }),
            getAll: () => ({ onsuccess: null, onerror: null }),
            put: () => ({ onsuccess: null, onerror: null }),
            delete: () => ({ onsuccess: null, onerror: null })
        })
    })
};

const sandbox = {
    document: {
        documentElement: mockElement(),
        getElementById: () => mockElement()
    },
    window: {
        matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} })
    },
    localStorage: {
        getItem: () => null,
        setItem: () => {}
    },
    indexedDB: {
        open: () => ({ onerror: () => {}, onsuccess: () => {} })
    },
    module: { exports: {} },
    exports: {},
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    Number: Number,
    Intl: Intl,
    Array: Array,
    Object: Object,
    Set: Set
};

const fn = new Function(...Object.keys(sandbox), appJsCode + "\nreturn module.exports;");
const {
    filterTransactions,
    calculateCategoryMonthlySpent,
    getCategoryLimitStatus,
    getExportData
} = fn(...Object.values(sandbox));

console.log("Running category budget limits tests...");

// --- 1. calculateCategoryMonthlySpent: Calendar month isolation & resets ---
const testTxs = [
    { id: 1, description: "Groceries A", amount: 120, category: "Groceries", date: "2026-10-02T10:00:00Z" },
    { id: 2, description: "Groceries B", amount: 80, category: "Groceries", date: "2026-10-15T12:00:00Z" },
    { id: 3, description: "September Groceries", amount: 250, category: "Groceries", date: "2026-09-20T10:00:00Z" },
    { id: 4, description: "November Rent", amount: 1500, category: "Housing", date: "2026-11-01T08:00:00Z" },
    { id: 5, description: "Dining Out", amount: 45, category: "Dining", date: "2026-10-22T19:00:00Z" },
    { id: 6, description: "No category expense", amount: 30, category: "", date: "2026-10-25T11:00:00Z" }
];

// Month calculation for October 2026:
const octTotals = calculateCategoryMonthlySpent(testTxs, "2026-10");
assert.strictEqual(octTotals["Groceries"], 200, "October groceries should sum 120 + 80 = 200");
assert.strictEqual(octTotals["Dining"], 45, "October dining should be 45");
assert.strictEqual(octTotals["General"], 30, "Missing category should default to General");
assert.strictEqual(octTotals["Housing"], undefined, "November expense must not appear in October");

// Month calculation for September 2026:
const sepTotals = calculateCategoryMonthlySpent(testTxs, "2026-09");
assert.strictEqual(sepTotals["Groceries"], 250, "September groceries should be 250");
assert.strictEqual(sepTotals["Dining"], undefined, "October dining must not appear in September");

// Month calculation for December 2026 (empty / reset month):
const decTotals = calculateCategoryMonthlySpent(testTxs, "2026-12");
assert.deepStrictEqual(decTotals, {}, "New/empty month must return empty totals (resets every month)");

// Safe handling for invalid or empty transaction lists
assert.deepStrictEqual(calculateCategoryMonthlySpent([], "2026-10"), {});
assert.deepStrictEqual(calculateCategoryMonthlySpent(null, "2026-10"), {});
assert.deepStrictEqual(calculateCategoryMonthlySpent(testTxs, null), {});

// --- 2. getCategoryLimitStatus: Threshold transitions ---
// Safe handling with zero or negative limit
const zeroLimit = getCategoryLimitStatus(100, 0);
assert.strictEqual(zeroLimit.status, "none");
assert.strictEqual(zeroLimit.isOver, false);
assert.strictEqual(zeroLimit.isWarning, false);

// Under 80%: Normal / On Track
const underLimit = getCategoryLimitStatus(150, 200); // 75%
assert.strictEqual(underLimit.status, "ok");
assert.strictEqual(underLimit.isWarning, false);
assert.strictEqual(underLimit.isOver, false);
assert.strictEqual(underLimit.pct, 75);
assert.strictEqual(underLimit.icon, "✓");
assert.ok(underLimit.label.includes("On Track"));

// Exactly 80%: Warning state
const exactWarning = getCategoryLimitStatus(160, 200); // 80%
assert.strictEqual(exactWarning.status, "warning");
assert.strictEqual(exactWarning.isWarning, true);
assert.strictEqual(exactWarning.isOver, false);
assert.strictEqual(exactWarning.pct, 80);
assert.strictEqual(exactWarning.icon, "⚠️");
assert.ok(exactWarning.label.includes("Warning"));

// Between 80% and 100%: Warning state
const highWarning = getCategoryLimitStatus(190, 200); // 95%
assert.strictEqual(highWarning.status, "warning");
assert.strictEqual(highWarning.isWarning, true);
assert.strictEqual(highWarning.isOver, false);
assert.strictEqual(highWarning.pct, 95);
assert.strictEqual(highWarning.icon, "⚠️");

// Exactly 100%: Over budget state
const exactOver = getCategoryLimitStatus(200, 200); // 100%
assert.strictEqual(exactOver.status, "over");
assert.strictEqual(exactOver.isOver, true);
assert.strictEqual(exactOver.isWarning, false);
assert.strictEqual(exactOver.pct, 100);
assert.strictEqual(exactOver.icon, "🚨");
assert.ok(exactOver.label.includes("Over Budget"));

// Above 100%: Over budget state
const wellOver = getCategoryLimitStatus(260, 200); // 130%
assert.strictEqual(wellOver.status, "over");
assert.strictEqual(wellOver.isOver, true);
assert.strictEqual(wellOver.isWarning, false);
assert.strictEqual(wellOver.pct, 130);
assert.strictEqual(wellOver.icon, "🚨");
assert.ok(wellOver.label.includes("Over Budget"));

// --- 3. Acceptance Criterion: Warning and over-budget states visually distinct and not conveyed by color alone ---
assert.notStrictEqual(exactWarning.icon, exactOver.icon, "Warning and Over budget must have distinct icons");
assert.notStrictEqual(exactWarning.label, exactOver.label, "Warning and Over budget must have distinct text labels");
assert.ok(exactWarning.icon.length > 0, "Warning has visible icon");
assert.ok(exactOver.icon.length > 0, "Over budget has visible icon");

console.log("All category budget limits tests passed successfully!");
