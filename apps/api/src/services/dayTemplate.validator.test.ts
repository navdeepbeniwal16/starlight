import { validateDayTemplate, validateDayShape, DayTemplateValidationError, DayShapeValidationError } from "./dayTemplate.validator";
import { BlockInput, DayShape } from "../types/dayTemplate.types";

// A valid baseline template; individual tests clone and mutate it to isolate one broken invariant.
function validTemplate(): { name: string; wakeTime: string; sleepTime: string; blocks: BlockInput[] } {
    return {
        name: "Workday",
        wakeTime: "07:00",
        sleepTime: "23:00",
        blocks: [
            { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
            { type: "ANCHOR", name: "Wind Down", startTime: "20:00", endTime: "22:00" },
        ],
    };
}

describe("validateDayTemplate", () => {
    describe("valid input", () => {
        it("accepts a well-formed template", () => {
            expect(() => validateDayTemplate(validTemplate())).not.toThrow();
        });
    });

    describe("name", () => {
        it("rejects a blank name", () => {
            expect(() => validateDayTemplate({ ...validTemplate(), name: "   " })).toThrow(/name must not be empty/i);
        });

        it("rejects an over-length name", () => {
            expect(() => validateDayTemplate({ ...validTemplate(), name: "x".repeat(51) })).toThrow(/at most 50/);
        });

        it("accepts a name at the length limit", () => {
            expect(() => validateDayTemplate({ ...validTemplate(), name: "x".repeat(50) })).not.toThrow();
        });
    });

    describe("wake/sleep window", () => {
        it("rejects a malformed wakeTime", () => {
            expect(() => validateDayTemplate({ ...validTemplate(), wakeTime: "7am" })).toThrow(/HH:mm/);
        });

        it("rejects a malformed sleepTime", () => {
            expect(() => validateDayTemplate({ ...validTemplate(), sleepTime: "11pm" })).toThrow(/HH:mm/);
        });

        it("rejects wakeTime equal to sleepTime", () => {
            const t = validTemplate();
            t.wakeTime = "23:00";
            expect(() => validateDayTemplate(t)).toThrow(/wakeTime must be before sleepTime/);
        });

        it("rejects wakeTime after sleepTime", () => {
            const t = { ...validTemplate(), wakeTime: "23:30", sleepTime: "07:00" };
            expect(() => validateDayTemplate(t)).toThrow(DayTemplateValidationError);
        });
    });

    describe("blocks array", () => {
        it("rejects an empty blocks array", () => {
            expect(() => validateDayTemplate({ ...validTemplate(), blocks: [] })).toThrow(/non-empty/);
        });
    });

    describe("block fields", () => {
        it("rejects an invalid block type", () => {
            const t = validTemplate();
            (t.blocks[0] as any).type = "MEETING";
            expect(() => validateDayTemplate(t)).toThrow(/invalid type/);
        });

        it("rejects a block with a blank name", () => {
            const t = validTemplate();
            t.blocks[0] = { ...t.blocks[0], name: "   " };
            expect(() => validateDayTemplate(t)).toThrow(/non-empty name/);
        });

        it("rejects an out-of-range time", () => {
            const t = validTemplate();
            t.blocks[0] = { ...t.blocks[0], startTime: "25:00" };
            expect(() => validateDayTemplate(t)).toThrow(DayTemplateValidationError);
        });

        it("rejects an invalid energyLevel", () => {
            const t = validTemplate();
            (t.blocks[0] as any).energyLevel = "EXTREME";
            expect(() => validateDayTemplate(t)).toThrow(/invalid energyLevel/);
        });
    });

    describe("block time range", () => {
        it("rejects a block whose startTime is not before its endTime", () => {
            const t = validTemplate();
            t.blocks[0] = { ...t.blocks[0], startTime: "12:00", endTime: "12:00" };
            expect(() => validateDayTemplate(t)).toThrow(DayTemplateValidationError);
        });

        it("rejects a block whose startTime is after its endTime", () => {
            const t = validTemplate();
            t.blocks[0] = { ...t.blocks[0], startTime: "13:00", endTime: "12:00" };
            expect(() => validateDayTemplate(t)).toThrow(/start before it ends/);
        });
    });

    describe("container rules", () => {
        it("rejects a CONTAINER block without an energyLevel", () => {
            const t = validTemplate();
            t.blocks[0] = { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00" };
            expect(() => validateDayTemplate(t)).toThrow(/CONTAINER.*energyLevel/);
        });

        it("rejects a template with no CONTAINER block", () => {
            const t = validTemplate();
            t.blocks = t.blocks.filter((b) => b.type !== "CONTAINER");
            expect(() => validateDayTemplate(t)).toThrow(/at least one CONTAINER/i);
        });
    });

    describe("block placement", () => {
        it("rejects overlapping blocks", () => {
            const t = validTemplate();
            t.blocks.push({ type: "ANCHOR", name: "Overlap", startTime: "11:30", endTime: "12:30" });
            expect(() => validateDayTemplate(t)).toThrow(/overlap/);
        });

        it("rejects a block outside the wake/sleep window", () => {
            const t = validTemplate();
            t.blocks[2] = { type: "ANCHOR", name: "Too Late", startTime: "22:30", endTime: "23:30" };
            expect(() => validateDayTemplate({ ...t, sleepTime: "23:00" })).toThrow(/outside the wake\/sleep window/);
        });
    });
});

// A valid baseline shape; tests clone and mutate it to isolate one broken invariant.
function validShape(): DayShape {
    return {
        wakeTime: "07:00",
        sleepTime: "23:00",
        blocks: [
            { id: "b1", type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { id: "b2", type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
        ],
    };
}

describe("validateDayShape", () => {
    it("accepts a well-formed shape", () => {
        expect(() => validateDayShape(validShape())).not.toThrow();
    });

    describe("shared geometry", () => {
        it("rejects a malformed wakeTime", () => {
            const call = () => validateDayShape({ ...validShape(), wakeTime: "7am" });
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/HH:mm/);
        });

        it("rejects wakeTime not before sleepTime", () => {
            const call = () => validateDayShape({ ...validShape(), wakeTime: "23:00" });
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/wakeTime must be before sleepTime/);
        });

        it("rejects an empty blocks array", () => {
            const call = () => validateDayShape({ ...validShape(), blocks: [] });
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/non-empty/);
        });

        it("rejects a block whose startTime is not before its endTime", () => {
            const s = validShape();
            s.blocks[0] = { ...s.blocks[0], startTime: "12:00", endTime: "12:00" };
            const call = () => validateDayShape(s);
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/start before it ends/);
        });

        it("rejects a CONTAINER block without an energyLevel", () => {
            const s = validShape();
            s.blocks[0] = { id: "b1", type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00" };
            const call = () => validateDayShape(s);
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/CONTAINER.*energyLevel/);
        });

        it("rejects a block outside the wake/sleep window", () => {
            const s = validShape();
            s.blocks[1] = { id: "b2", type: "ANCHOR", name: "Too Late", startTime: "22:30", endTime: "23:30" };
            const call = () => validateDayShape({ ...s, sleepTime: "23:00" });
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/outside the wake\/sleep window/);
        });
    });

    describe("block ids", () => {
        it("rejects a blank id", () => {
            const s = validShape();
            s.blocks[0] = { ...s.blocks[0], id: "   " };
            const call = () => validateDayShape(s);
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/non-empty id/);
        });

        it("rejects duplicate ids", () => {
            const s = validShape();
            s.blocks[1] = { ...s.blocks[1], id: "b1" };
            const call = () => validateDayShape(s);
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/duplicate id/);
        });
    });

    describe("shares the template's structural rules", () => {
        it("rejects overlapping blocks", () => {
            const s = validShape();
            s.blocks.push({ id: "b3", type: "ANCHOR", name: "Overlap", startTime: "11:30", endTime: "12:30" });
            const call = () => validateDayShape(s);
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/overlap/);
        });

        it("rejects a shape with no CONTAINER block", () => {
            const s = validShape();
            s.blocks = s.blocks.filter((b) => b.type !== "CONTAINER");
            const call = () => validateDayShape(s);
            expect(call).toThrow(DayShapeValidationError);
            expect(call).toThrow(/at least one CONTAINER/i);
        });
    });
});
