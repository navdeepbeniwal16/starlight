import {
    resolveDefaultTemplate,
    templateRecencyBasis,
    draftToShape,
    templateToShape,
    hasSchedulableBlock,
} from "./planTemplate";
import type { DayTemplate } from "./api.types";
import type { TemplateDraft } from "./templateDraft";

function template(over: Partial<DayTemplate> = {}): DayTemplate {
    return {
        id: "t1",
        name: "Workday",
        wakeTime: "06:00",
        sleepTime: "22:00",
        updatedAt: "2026-10-01T08:00:00.000Z",
        lastUsedOn: null,
        blocks: [
            { id: "b1", type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { id: "b2", type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
        ],
        ...over,
    };
}

function draft(over: Partial<TemplateDraft> = {}): TemplateDraft {
    return {
        wakeTime: "06:00",
        sleepTime: "22:00",
        blocks: [
            { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
        ],
        ...over,
    };
}

describe("resolveDefaultTemplate", () => {
    it("returns null for no templates", () => {
        expect(resolveDefaultTemplate([])).toBeNull();
    });

    it("picks the most recent lastUsedOn", () => {
        const a = template({ id: "a", lastUsedOn: "2026-09-10" });
        const b = template({ id: "b", lastUsedOn: "2026-09-20" });
        const c = template({ id: "c", lastUsedOn: "2026-09-15" });
        expect(resolveDefaultTemplate([a, b, c])!.id).toBe("b");
    });

    it("ignores updatedAt when any template has a lastUsedOn", () => {
        const used = template({ id: "used", lastUsedOn: "2026-09-10", updatedAt: "2026-01-01T00:00:00.000Z" });
        const freshlyEdited = template({ id: "edited", lastUsedOn: null, updatedAt: "2026-12-31T00:00:00.000Z" });
        expect(resolveDefaultTemplate([freshlyEdited, used])!.id).toBe("used");
    });

    it("falls back to most-recently-updated when all lastUsedOn are null", () => {
        const a = template({ id: "a", lastUsedOn: null, updatedAt: "2026-05-01T00:00:00.000Z" });
        const b = template({ id: "b", lastUsedOn: null, updatedAt: "2026-07-01T00:00:00.000Z" });
        expect(resolveDefaultTemplate([a, b])!.id).toBe("b");
    });
});

describe("templateRecencyBasis", () => {
    it("reads from lastUsedOn when present", () => {
        expect(templateRecencyBasis(template({ lastUsedOn: "2026-09-20" }))).toEqual({
            kind: "lastUsed",
            date: "2026-09-20",
        });
    });

    it("reads from updatedAt when never used", () => {
        expect(templateRecencyBasis(template({ lastUsedOn: null, updatedAt: "2026-10-01T08:00:00.000Z" }))).toEqual({
            kind: "updated",
            date: "2026-10-01T08:00:00.000Z",
        });
    });
});

describe("draftToShape", () => {
    it("zips blockKeys as client-stable block ids", () => {
        const shape = draftToShape(draft(), ["blk_1", "blk_2"]);
        expect(shape.wakeTime).toBe("06:00");
        expect(shape.sleepTime).toBe("22:00");
        expect(shape.blocks.map((b) => b.id)).toEqual(["blk_1", "blk_2"]);
        expect(shape.blocks[0]).toMatchObject({ id: "blk_1", type: "CONTAINER", energyLevel: "HIGH" });
    });
});

describe("templateToShape", () => {
    it("keys blocks off their persisted ids", () => {
        const shape = templateToShape(template());
        expect(shape.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    });

    it("omits energyLevel on anchor blocks", () => {
        const shape = templateToShape(template());
        expect("energyLevel" in shape.blocks[1]).toBe(false);
    });
});

describe("hasSchedulableBlock", () => {
    it("is false with no draft", () => {
        expect(hasSchedulableBlock(null, "08:00")).toBe(false);
    });

    it("is false when no container block exists", () => {
        const anchorsOnly = draft({ blocks: [{ type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" }] });
        expect(hasSchedulableBlock(anchorsOnly, "08:00")).toBe(false);
    });

    it("is true when a container block ends after now", () => {
        expect(hasSchedulableBlock(draft(), "10:00")).toBe(true);
    });

    it("is false when every container has elapsed", () => {
        expect(hasSchedulableBlock(draft(), "13:00")).toBe(false);
    });
});
