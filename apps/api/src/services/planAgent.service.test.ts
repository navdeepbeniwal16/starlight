import {
    buildAgentInput,
    parseAgentResult,
    generateSchedule,
    AgentError,
    type RawBlock,
    type RawTask,
    type AgentInput,
} from "./planAgent.service";

// ─── buildAgentInput ──────────────────────────────────────────────────────────

function block(overrides: Partial<RawBlock> = {}): RawBlock {
    return {
        id: "b1",
        type: "CONTAINER",
        name: "Deep Work",
        startTime: "09:00",
        endTime: "12:00",
        energyLevel: "HIGH",
        ...overrides,
    };
}

function task(overrides: Partial<RawTask> = {}): RawTask {
    return {
        id: "t1",
        title: "Task",
        estimatedMins: 60,
        progress: null,
        effort: "MEDIUM",
        priority: "HIGH",
        deadline: null,
        status: "TODO",
        ...overrides,
    };
}

describe("buildAgentInput", () => {
    it("includes only CONTAINER blocks", () => {
        const input = buildAgentInput(
            [
                block({ id: "c1", type: "CONTAINER" }),
                block({ id: "a1", type: "ANCHOR" }),
                block({ id: "n1", type: "NO_TASK" }),
            ],
            [],
        );
        expect(input.blocks.map(b => b.id)).toEqual(["c1"]);
    });

    it("pre-computes remainingMins as estimatedMins × (1 − progress/100)", () => {
        const input = buildAgentInput(
            [],
            [
                task({ id: "none", estimatedMins: 60, progress: null }),
                task({ id: "zero", estimatedMins: 60, progress: 0 }),
                task({ id: "half", estimatedMins: 60, progress: 50 }),
                task({ id: "most", estimatedMins: 90, progress: 75 }),
                task({ id: "done", estimatedMins: 60, progress: 100 }),
            ],
        );
        const byId = Object.fromEntries(input.tasks.map(t => [t.id, t.remainingMins]));
        expect(byId).toEqual({ none: 60, zero: 60, half: 30, most: 23, done: 0 });
    });

    it("serialises deadline to an ISO string and passes through null", () => {
        const deadline = new Date("2026-06-25T09:00:00.000Z");
        const input = buildAgentInput(
            [],
            [
                task({ id: "with", deadline }),
                task({ id: "without", deadline: null }),
            ],
        );
        const byId = Object.fromEntries(input.tasks.map(t => [t.id, t.deadline]));
        expect(byId).toEqual({ with: "2026-06-25T09:00:00.000Z", without: null });
    });
});

// ─── parseAgentResult ─────────────────────────────────────────────────────────

describe("parseAgentResult", () => {
    it("parses a well-formed result", () => {
        const result = parseAgentResult({
            assignments: [{ taskId: "t1", blockId: "b1", blockOrder: 0 }],
            unschedulable: [{ taskId: "t2", reason: "too long" }],
        });
        expect(result.assignments).toHaveLength(1);
        expect(result.unschedulable[0]).toEqual({ taskId: "t2", reason: "too long" });
    });

    it("throws AgentError when the shape is wrong", () => {
        expect(() => parseAgentResult({ assignments: [{ taskId: "t1" }] })).toThrow(AgentError);
        expect(() => parseAgentResult(null)).toThrow(AgentError);
        expect(() => parseAgentResult({ assignments: [], unschedulable: [{ taskId: 1, reason: "x" }] })).toThrow(AgentError);
    });
});

// ─── generateSchedule (injected fixture) ──────────────────────────────────────

describe("generateSchedule", () => {
    it("passes CONTAINER-only blocks and pre-computed remainingMins to the agent", async () => {
        let captured: AgentInput | undefined;
        const deps = {
            callAgent: async (input: AgentInput) => {
                captured = input;
                return { assignments: [], unschedulable: [] };
            },
        };

        await generateSchedule(
            [block({ id: "c1", type: "CONTAINER" }), block({ id: "a1", type: "ANCHOR" })],
            [task({ id: "t1", estimatedMins: 80, progress: 25 })],
            deps,
        );

        expect(captured!.blocks.map(b => b.id)).toEqual(["c1"]);
        expect(captured!.tasks[0]).toMatchObject({ id: "t1", remainingMins: 60 });
    });

    it("returns the parsed agent output (recorded fixture)", async () => {
        // Stands in for a recorded Claude tool_use response in CI.
        const fixture = {
            assignments: [{ taskId: "t1", blockId: "c1", blockOrder: 0 }],
            unschedulable: [{ taskId: "t2", reason: "remainingMins exceeds all block capacities" }],
        };
        const deps = { callAgent: async () => fixture };

        const result = await generateSchedule([block({ id: "c1" })], [task()], deps);

        expect(result).toEqual(fixture);
    });

    it("rejects malformed agent output with AgentError", async () => {
        const deps = { callAgent: async () => ({ assignments: "nope" }) };
        await expect(generateSchedule([block()], [task()], deps)).rejects.toThrow(AgentError);
    });
});
