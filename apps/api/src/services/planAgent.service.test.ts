import {
    buildAgentInput,
    parseAgentResult,
    normalizeAssignments,
    overflowsOf,
    evictToFit,
    generateSchedule,
    AgentError,
    CAPACITY_TOLERANCE_MINS,
    FLOOR_EVICTION_REASON,
    type AgentResult,
    type AgentBlock,
    type AgentTask,
    type Assignment,
    type RawBlock,
    type RawTask,
    type AgentInput,
} from "./planAgent.service";
import type { Anthropic } from "@anthropic-ai/sdk";

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

// ─── normalizeAssignments ─────────────────────────────────────────────────────

describe("normalizeAssignments", () => {
    const containers = new Set(["c1", "c2"]);
    const tasks = new Set(["t1", "t2"]);

    function result(assignments: AgentResult["assignments"]): AgentResult {
        return { assignments, unschedulable: [] };
    }

    it("drops assignments to bogus or non-CONTAINER blocks", () => {
        const out = normalizeAssignments(
            result([
                { taskId: "t1", blockId: "c1", blockOrder: 0 },
                { taskId: "t2", blockId: "anchor", blockOrder: 0 }, // not a CONTAINER id
            ]),
            containers,
            tasks,
        );
        expect(out.assignments).toEqual([{ taskId: "t1", blockId: "c1", blockOrder: 0 }]);
    });

    it("drops assignments to unknown tasks", () => {
        const out = normalizeAssignments(
            result([
                { taskId: "ghost", blockId: "c1", blockOrder: 0 },
                { taskId: "t2", blockId: "c1", blockOrder: 1 },
            ]),
            containers,
            tasks,
        );
        expect(out.assignments).toEqual([{ taskId: "t2", blockId: "c1", blockOrder: 1 }]);
    });

    it("keeps a duplicated task only once, first occurrence wins", () => {
        const out = normalizeAssignments(
            result([
                { taskId: "t1", blockId: "c1", blockOrder: 0 },
                { taskId: "t1", blockId: "c2", blockOrder: 3 }, // duplicate task
            ]),
            containers,
            tasks,
        );
        expect(out.assignments).toEqual([{ taskId: "t1", blockId: "c1", blockOrder: 0 }]);
    });

    it("passes unschedulable through untouched", () => {
        const unschedulable = [{ taskId: "t2", reason: "too long" }];
        const out = normalizeAssignments({ assignments: [], unschedulable }, containers, tasks);
        expect(out.unschedulable).toEqual(unschedulable);
    });
});

// ─── capacity guardrail (overflowsOf / evictToFit) ────────────────────────────

function agentBlock(overrides: Partial<AgentBlock> = {}): AgentBlock {
    return { id: "c1", name: "Deep Work", startTime: "09:00", endTime: "10:00", energyLevel: "HIGH", ...overrides };
}

function agentTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return { id: "t1", title: "Task", remainingMins: 30, effort: "MEDIUM", priority: "HIGH", deadline: null, status: "TODO", ...overrides };
}

function assign(taskId: string, blockId: string, blockOrder: number): Assignment {
    return { taskId, blockId, blockOrder };
}

describe("overflowsOf", () => {
    // A 60-minute block (09:00–10:00) with the default 15-minute tolerance.
    const blocks = [agentBlock({ id: "c1", startTime: "09:00", endTime: "10:00" })];

    it("treats committed === capacity + tolerance as within tolerance (not over)", () => {
        const tasks = [agentTask({ id: "t1", remainingMins: 75 })]; // 60 capacity + 15 tolerance
        const out = overflowsOf(blocks, tasks, [assign("t1", "c1", 0)], CAPACITY_TOLERANCE_MINS);
        expect(out).toEqual([]);
    });

    it("reports a block one minute past the tolerance boundary, overflow measured vs capacity", () => {
        const tasks = [agentTask({ id: "t1", remainingMins: 76 })]; // 1 past 60 + 15
        const out = overflowsOf(blocks, tasks, [assign("t1", "c1", 0)], CAPACITY_TOLERANCE_MINS);
        expect(out).toEqual([{ blockId: "c1", capacity: 60, committed: 76, overflow: 16 }]);
    });

    it("sums a block's committed work and reports overflow past true capacity", () => {
        const tasks = [agentTask({ id: "t1", remainingMins: 50 }), agentTask({ id: "t2", remainingMins: 40 })];
        const out = overflowsOf(blocks, tasks, [assign("t1", "c1", 0), assign("t2", "c1", 1)], CAPACITY_TOLERANCE_MINS);
        expect(out).toEqual([{ blockId: "c1", capacity: 60, committed: 90, overflow: 30 }]);
    });

    it("returns only the over-capacity blocks; a block with no assignments is never over", () => {
        const two = [
            agentBlock({ id: "c1", startTime: "09:00", endTime: "10:00" }), // 60, overcommitted
            agentBlock({ id: "c2", startTime: "10:00", endTime: "12:00" }), // 120, empty
        ];
        const tasks = [agentTask({ id: "t1", remainingMins: 100 })];
        const out = overflowsOf(two, tasks, [assign("t1", "c1", 0)], CAPACITY_TOLERANCE_MINS);
        expect(out.map(o => o.blockId)).toEqual(["c1"]);
    });
});

describe("evictToFit", () => {
    // 60-minute block, three 30-minute tasks (committed 90), zero tolerance.
    const blocks = [agentBlock({ id: "c1", startTime: "09:00", endTime: "10:00" })];
    const tasks = [
        agentTask({ id: "t0", remainingMins: 30 }),
        agentTask({ id: "t1", remainingMins: 30 }),
        agentTask({ id: "t2", remainingMins: 30 }),
    ];
    const assignments = [assign("t0", "c1", 0), assign("t1", "c1", 1), assign("t2", "c1", 2)];

    it("evicts the highest-blockOrder task first and stops as soon as the block fits", () => {
        const out = evictToFit(blocks, tasks, assignments, 0);
        // Evicting t2 (order 2) drops committed to 60 == capacity — t1 must not also go.
        expect(out.evicted).toEqual(["t2"]);
        expect(out.assignments).toEqual([assign("t0", "c1", 0), assign("t1", "c1", 1)]);
    });

    it("keeps evicting in descending blockOrder until within capacity + tolerance", () => {
        // A single 30-minute block forces two evictions to get committed (90) down to 30.
        const tiny = [agentBlock({ id: "c1", startTime: "09:00", endTime: "09:30" })];
        const out = evictToFit(tiny, tasks, assignments, 0);
        expect(out.evicted).toEqual(["t2", "t1"]);
        expect(out.assignments).toEqual([assign("t0", "c1", 0)]);
    });

    it("leaves a block already within capacity + tolerance untouched", () => {
        const roomy = [agentBlock({ id: "c1", startTime: "09:00", endTime: "12:00" })]; // 180 capacity
        const out = evictToFit(roomy, tasks, assignments, CAPACITY_TOLERANCE_MINS);
        expect(out.evicted).toEqual([]);
        expect(out.assignments).toEqual(assignments);
    });

    it("lets the tolerance absorb an overrun within the slack", () => {
        // Committed 70 on a 60 block is 10 over — inside the 15-minute tolerance.
        const twoTasks = [agentTask({ id: "t0", remainingMins: 40 }), agentTask({ id: "t1", remainingMins: 30 })];
        const out = evictToFit(blocks, twoTasks, [assign("t0", "c1", 0), assign("t1", "c1", 1)], CAPACITY_TOLERANCE_MINS);
        expect(out.evicted).toEqual([]);
    });
});

// ─── generateSchedule (injected fixture) ──────────────────────────────────────

describe("generateSchedule", () => {
    it("passes CONTAINER-only blocks and pre-computed remainingMins to the agent", async () => {
        let captured: AgentInput | undefined;
        const deps = {
            callModel: async (messages: Anthropic.MessageParam[]) => {
                captured = JSON.parse(messages[0].content as string) as AgentInput;
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
        const deps = { callModel: async () => fixture };

        const result = await generateSchedule([block({ id: "c1" })], [task()], deps);

        expect(result).toEqual(fixture);
    });

    it("rejects malformed agent output with AgentError", async () => {
        const deps = { callModel: async () => ({ assignments: "nope" }) };
        await expect(generateSchedule([block()], [task()], deps)).rejects.toThrow(AgentError);
    });

    it("applies the floor when the model overcommits a block: trims it and marks the evicted task unschedulable", async () => {
        // A 60-minute block the model packs with 100 minutes of work (2 × 50).
        const fixture = {
            assignments: [
                { taskId: "t1", blockId: "c1", blockOrder: 0 },
                { taskId: "t2", blockId: "c1", blockOrder: 1 },
            ],
            unschedulable: [],
        };
        const deps = { callModel: async () => fixture };

        const result = await generateSchedule(
            [block({ id: "c1", startTime: "09:00", endTime: "10:00" })],
            [task({ id: "t1", estimatedMins: 50 }), task({ id: "t2", estimatedMins: 50 })],
            deps,
        );

        // The highest-blockOrder task is evicted until the block fits within tolerance.
        expect(result.assignments).toEqual([{ taskId: "t1", blockId: "c1", blockOrder: 0 }]);
        expect(result.unschedulable).toEqual([{ taskId: "t2", reason: FLOOR_EVICTION_REASON }]);
    });
});
