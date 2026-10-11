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
});
