import { defaultTemplate, templateRecency } from "./templateSelection";
import type { DayTemplate } from "./api.types";

function template(id: string, over: Partial<DayTemplate> = {}): DayTemplate {
    return {
        id,
        name: id,
        wakeTime: "07:00",
        sleepTime: "23:00",
        blocks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastUsedOn: null,
        ...over,
    };
}

describe("defaultTemplate", () => {
    it("returns null for an empty list", () => {
        expect(defaultTemplate([])).toBeNull();
    });

    it("returns the only template when there is one", () => {
        const only = template("a");
        expect(defaultTemplate([only])).toBe(only);
    });

    it("picks the template with the most recent lastUsedOn", () => {
        const older = template("older", { lastUsedOn: "2026-09-15" });
        const newer = template("newer", { lastUsedOn: "2026-09-20" });
        expect(defaultTemplate([older, newer])).toBe(newer);
    });

    it("ignores updatedAt once any template has been used", () => {
        const used = template("used", { lastUsedOn: "2026-09-10", updatedAt: "2026-01-01T00:00:00.000Z" });
        const fresh = template("fresh", { lastUsedOn: null, updatedAt: "2026-09-30T00:00:00.000Z" });
        expect(defaultTemplate([fresh, used])).toBe(used);
    });

    it("falls back to the most-recently-updated template when all are unused", () => {
        const older = template("older", { updatedAt: "2026-02-01T00:00:00.000Z" });
        const newer = template("newer", { updatedAt: "2026-05-01T00:00:00.000Z" });
        expect(defaultTemplate([older, newer])).toBe(newer);
    });
});

describe("templateRecency", () => {
    it("reports last-used when the template has been used", () => {
        const t = template("a", { lastUsedOn: "2026-09-20", updatedAt: "2026-01-01T00:00:00.000Z" });
        expect(templateRecency(t)).toEqual({ label: "Last used", at: "2026-09-20" });
    });

    it("falls back to last-updated when the template has never been used", () => {
        const t = template("a", { lastUsedOn: null, updatedAt: "2026-03-04T05:06:07.000Z" });
        expect(templateRecency(t)).toEqual({ label: "Updated", at: "2026-03-04T05:06:07.000Z" });
    });
});
