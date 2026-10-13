import { buildDuplicateDraft, duplicateName } from "./duplicateTemplate";
import { isTemplateValid } from "./templateDraft";
import type { DayTemplate } from "./api.types";

const source: DayTemplate = {
    id: "tmpl_1",
    name: "Workday",
    wakeTime: "06:30",
    sleepTime: "22:30",
    updatedAt: "2026-10-01T08:00:00.000Z",
    blocks: [
        { id: "blk_1", type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
        { id: "blk_2", type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
    ],
};

describe("buildDuplicateDraft", () => {
    it("names the copy '<name> copy'", () => {
        expect(buildDuplicateDraft(source).name).toBe("Workday copy");
    });

    it("carries the source wake/sleep and blocks", () => {
        const { draft } = buildDuplicateDraft(source);
        expect(draft.wakeTime).toBe("06:30");
        expect(draft.sleepTime).toBe("22:30");
        expect(draft.blocks).toEqual([
            { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
        ]);
    });

    it("drops block ids so the copy shares no identity with the source", () => {
        const { draft } = buildDuplicateDraft(source);
        for (const block of draft.blocks) {
            expect(block).not.toHaveProperty("id");
        }
    });

    it("is independent — mutating the copy does not touch the source", () => {
        const { draft } = buildDuplicateDraft(source);
        draft.blocks[0].name = "Changed";
        expect(source.blocks[0].name).toBe("Deep Work");
    });

    it("produces a draft the editor accepts as valid, so it can be saved as-is", () => {
        expect(isTemplateValid(buildDuplicateDraft(source).draft)).toBe(true);
    });
});
