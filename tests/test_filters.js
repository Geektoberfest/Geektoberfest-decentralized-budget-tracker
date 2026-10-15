const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Load app.js in a safe sandbox mock environment
const appJsPath = path.join(__dirname, "../static/app.js");
const appJsCode = fs.readFileSync(appJsPath, "utf-8");

// Mock browser objects needed to execute app.js in node
const mockElement = () => ({
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    innerHTML: "",
    textContent: "",
    value: ""
});

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
    Object: Object
};

const fn = new Function(...Object.keys(sandbox), appJsCode + "\nreturn module.exports;");
const { filterTransactions } = fn(...Object.values(sandbox));

console.log("Running filterTransactions tests...");

// Sample transactions
const mockTxs = [
    { id: 1, description: "Starbucks Coffee", amount: 5.5, category: "Food & Dining", date: "2026-10-01T10:00:00Z" },
    { id: 2, description: "Monthly Apartment Rent", amount: 1200, category: "Housing", date: "2026-10-05T14:30:00Z" },
    { id: 3, description: "Grocery Market", amount: 85.2, category: "Food & Dining", date: "2026-09-15T11:00:00Z" },
    { id: 4, description: "Uber Ride", amount: 24.0, category: "Transportation", date: "2026-10-10T19:00:00Z" },
    { id: 5, description: "Netflix Subscription", amount: 15.0, category: "Entertainment", date: "2026-09-20T08:00:00Z" }
];

// 1. Search text case-insensitivity on description
let res = filterTransactions(mockTxs, { search: "coffee" });
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, 1);

// 2. Search text case-insensitivity on category
res = filterTransactions(mockTxs, { search: "dining" });
assert.strictEqual(res.length, 2);

// 3. Category filter exact match
res = filterTransactions(mockTxs, { category: "housing" });
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, 2);

// 4. Month filter
res = filterTransactions(mockTxs, { month: "2026-10" });
assert.strictEqual(res.length, 3);

res = filterTransactions(mockTxs, { month: "2026-09" });
assert.strictEqual(res.length, 2);

// 5. Date range filter
res = filterTransactions(mockTxs, { dateFrom: "2026-10-02", dateTo: "2026-10-06" });
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, 2);

// 6. Combined filters (search + category + month)
res = filterTransactions(mockTxs, { search: "coffee", category: "Food & Dining", month: "2026-10" });
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].id, 1);

// 7. Combined filters mismatch
res = filterTransactions(mockTxs, { search: "coffee", category: "Entertainment" });
assert.strictEqual(res.length, 0);

// 8. Performance with 5,000+ transactions
const largeTxs = [];
for (let i = 0; i < 6000; i++) {
    largeTxs.push({
        id: i,
        description: `Item #${i} groceries`,
        amount: (i % 100) + 1,
        category: i % 2 === 0 ? "Food & Dining" : "Utilities",
        date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`
    });
}
const start = Date.now();
const filteredLarge = filterTransactions(largeTxs, { search: "item #5", category: "Food & Dining", month: "2026-10" });
const elapsed = Date.now() - start;
console.log(`Filtered 6,000 transactions in ${elapsed}ms (found ${filteredLarge.length} matches)`);
assert(elapsed < 100, `Filtering took too long: ${elapsed}ms`);
assert(filteredLarge.length > 0);

// 9. Immutability: original array not modified
assert.strictEqual(mockTxs.length, 5);

console.log("All filterTransactions tests passed successfully!");
