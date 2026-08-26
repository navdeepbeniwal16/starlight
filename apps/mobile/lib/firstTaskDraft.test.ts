import { canPlanFirstTask, canPlanTasks } from "./firstTaskDraft";

describe("canPlanFirstTask", () => {
    it("allows planning with a title and an estimate", () => {
        expect(canPlanFirstTask({ title: "Write report", estimatedMins: 60 })).toBe(true);
    });

    it("blocks planning without an estimate", () => {
        expect(canPlanFirstTask({ title: "Write report", estimatedMins: null })).toBe(false);
    });

    it("blocks planning with an empty title", () => {
        expect(canPlanFirstTask({ title: "", estimatedMins: 60 })).toBe(false);
    });

    it("blocks planning with a whitespace-only title", () => {
        expect(canPlanFirstTask({ title: "   ", estimatedMins: 60 })).toBe(false);
    });
});

describe("canPlanTasks", () => {
    it("blocks planning with no tasks at all", () => {
        expect(canPlanTasks([])).toBe(false);
    });

    it("allows planning with a single valid task", () => {
        expect(canPlanTasks([{ title: "Write report", estimatedMins: 60 }])).toBe(true);
    });

    it("blocks planning when every task is incomplete", () => {
        expect(canPlanTasks([
            { title: "Write report", estimatedMins: null },
            { title: "", estimatedMins: 30 },
        ])).toBe(false);
    });

    it("allows planning when at least one of several tasks is valid", () => {
        expect(canPlanTasks([
            { title: "", estimatedMins: 30 },
            { title: "Write report", estimatedMins: 60 },
            { title: "Go for a walk", estimatedMins: null },
        ])).toBe(true);
    });
});
