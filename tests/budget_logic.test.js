const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const BL = require("../static/budget-logic.js");

describe("normalizeCategoryKey", () => {
    it("is case-insensitive and trims whitespace", () => {
        assert.equal(BL.normalizeCategoryKey("  Food "), "food");
        assert.equal(BL.normalizeCategoryKey("FOOD"), "food");
        assert.equal(BL.normalizeCategoryKey(""), "");
    });
});

describe("validateBudgetLimit", () => {
    it("accepts positive amounts rounded to cents", () => {
        assert.equal(BL.validateBudgetLimit(100), 100);
        assert.equal(BL.validateBudgetLimit("250.567"), 250.57);
    });
    it("rejects zero, negative, NaN and empty input", () => {
        assert.equal(BL.validateBudgetLimit(0), null);
        assert.equal(BL.validateBudgetLimit(-5), null);
        assert.equal(BL.validateBudgetLimit("abc"), null);
        assert.equal(BL.validateBudgetLimit(""), null);
        assert.equal(BL.validateBudgetLimit(null), null);
    });
});

describe("getBudgetStatus", () => {
    it("is ok below 80%", () => {
        assert.equal(BL.getBudgetStatus(79, 100).state, "ok");
    });
    it("warns at exactly 80%", () => {
        const s = BL.getBudgetStatus(80, 100);
        assert.equal(s.state, "warning");
        assert.equal(s.pct, 80);
    });
    it("is over at 100% and above", () => {
        assert.equal(BL.getBudgetStatus(100, 100).state, "over");
        assert.equal(BL.getBudgetStatus(150, 100).state, "over");
    });
    it("returns none without a usable limit", () => {
        assert.equal(BL.getBudgetStatus(50, 0).state, "none");
        assert.equal(BL.getBudgetStatus(50, null).state, "none");
    });
});

describe("monthly reset", () => {
    const txs = [
        { category: "Food", amount: 60, date: "2026-10-05T12:00:00.000Z" },
        { category: "food", amount: 20, date: "2026-10-20T12:00:00.000Z" },
        { category: "Food", amount: 500, date: "2026-09-15T12:00:00.000Z" },
    ];
    it("sums only the requested calendar month (case-insensitive)", () => {
        assert.equal(BL.sumSpentForCategory(txs, "FOOD", "2026-10"), 80);
        assert.equal(BL.sumSpentForCategory(txs, "food", "2026-09"), 500);
        assert.equal(BL.sumSpentForCategory(txs, "food", "2026-08"), 0);
    });
    it("matches month keys to local calendar months", () => {
        assert.equal(BL.isDateInMonth("2026-10-05T12:00:00.000Z", "2026-10"), true);
        assert.equal(BL.isDateInMonth("2026-10-05T12:00:00.000Z", "2026-09"), false);
        assert.equal(BL.isDateInMonth("not-a-date", "2026-10"), false);
    });
});

describe("buildExportPayload", () => {
    it("includes budgets alongside transactions", () => {
        const payload = BL.buildExportPayload(
            [{ description: "Lunch", amount: 12, category: "Food", date: "2026-10-01" }],
            [{ key: "food", display: "Food", limit: 200 }]
        );
        assert.equal(payload.transactions.length, 1);
        assert.deepEqual(payload.budgets, [{ category: "Food", limit: 200 }]);
    });
    it("round-trips through validateImportPayload without data loss", () => {
        const txs = [
            { id: 1, description: "Lunch", amount: 12.5, category: "Food", date: "2026-10-01T10:00:00.000Z" },
            { id: 2, description: "Refund", amount: -20, category: "General", date: "2026-10-02T10:00:00.000Z" },
        ];
        const budgets = [{ key: "food", display: "Food", limit: 200, updatedAt: "2026-10-01" }];
        const payload = JSON.parse(JSON.stringify(BL.buildExportPayload(txs, budgets)));
        const back = BL.validateImportPayload(payload);
        assert.deepEqual(back.transactions, txs.map(({ description, amount, category, date }) => ({ description, amount, category, date })));
        assert.deepEqual(back.budgets, [{ category: "Food", limit: 200 }]);
    });
});

describe("buildCsv", () => {
    it("has a header row with date, description, category, amount and type", () => {
        const csv = BL.buildCsv([{ description: "Lunch", amount: 12.5, category: "Food", date: "2026-10-01" }]);
        const lines = csv.split("\n");
        assert.equal(lines[0], "date,description,category,amount,type");
        assert.equal(lines[1], "2026-10-01,Lunch,Food,12.5,expense");
    });
    it("derives income type for negative amounts and escapes cells", () => {
        const csv = BL.buildCsv([{ description: 'Refund, "big" one', amount: -20, category: "Misc", date: "2026-10-02" }]);
        assert.ok(csv.includes('"Refund, ""big"" one"'));
        assert.ok(csv.endsWith(",income"));
    });
});

describe("validateImportPayload", () => {
    it("accepts older exports without a budgets array", () => {
        const back = BL.validateImportPayload({ transactions: [{ description: "Lunch", amount: 5 }] });
        assert.equal(back.transactions.length, 1);
        assert.deepEqual(back.budgets, []);
        assert.equal(back.transactions[0].category, "General");
    });
    it("rejects corrupt files with clear errors", () => {
        assert.throws(() => BL.validateImportPayload(null), /JSON object/);
        assert.throws(() => BL.validateImportPayload([]), /JSON object/);
        assert.throws(() => BL.validateImportPayload({}), /transaction list/);
        assert.throws(() => BL.validateImportPayload({ transactions: [{ amount: 5 }] }), /no description/);
        assert.throws(() => BL.validateImportPayload({ transactions: [{ description: "X", amount: "abc" }] }), /invalid amount/);
        assert.throws(() => BL.validateImportPayload({ transactions: [], budgets: [{ category: "Food", limit: -1 }] }), /invalid category or limit/);
    });
});

describe("dedupeNewTransactions", () => {
    const existing = [{ description: "Lunch", amount: 12.5, category: "Food", date: "2026-10-01T10:00:00.000Z" }];
    it("skips exact duplicates even with different date formatting or casing", () => {
        const incoming = [
            { description: "Lunch", amount: 12.5, category: "FOOD", date: "2026-10-01T10:00:00.000Z" },
            { description: "Lunch", amount: 12.5, category: "Food", date: "2026-10-01T10:00:00Z" },
        ];
        assert.deepEqual(BL.dedupeNewTransactions(existing, incoming), []);
    });
    it("keeps near-matches and dedupes within the incoming batch", () => {
        const incoming = [
            { description: "Lunch", amount: 13, category: "Food", date: "2026-10-01T10:00:00.000Z" },
            { description: "Dinner", amount: 30, category: "Food", date: "2026-10-01T10:00:00.000Z" },
            { description: "Dinner", amount: 30, category: "Food", date: "2026-10-01T10:00:00.000Z" },
        ];
        const fresh = BL.dedupeNewTransactions(existing, incoming);
        assert.equal(fresh.length, 2);
    });
});
