import type { PlanProposal, ProposalBlock } from "./api.types";
import {
    blockRemainingMins,
    blockZone,
    boardFromProposal,
    eligibleTargets,
    moveTask,
    planFromProposalAndBoard,
    targetZone,
    UNSCHEDULED,
    zoneFromActionName,
    zoneToActionName,
    zonesEqual,
    type ReviewBoard,
} from "./reviewBoard";

function block(partial: Partial<ProposalBlock> & { blockId: string; startTime: string; endTime: string }): ProposalBlock {
    return {
        type: "CONTAINER",
        name: partial.name ?? partial.blockId,
        energyLevel: null,
        tasks: [],
        elapsed: false,
        ...partial,
    };
}

function task(id: string, remainingMins: number) {
    return { id, title: id, estimatedMins: remainingMins, remainingMins, status: "TODO" as const };
}

function proposal(partial: Partial<PlanProposal> & { blocks: ProposalBlock[] }): PlanProposal {
    return {
        wakeTime: "07:00",
        sleepTime: "22:00",
        unschedulable: [],
        ...partial,
    };
}

describe("boardFromProposal", () => {
    it("keeps only upcoming CONTAINER blocks, sorted by start time", () => {
        const board = boardFromProposal(
            proposal({
                blocks: [
                    block({ blockId: "afternoon", startTime: "13:00", endTime: "15:00" }),
                    block({ blockId: "morning", startTime: "09:00", endTime: "11:00" }),
                    block({ blockId: "lunch", type: "ANCHOR", startTime: "12:00", endTime: "13:00" }),
                    block({ blockId: "past", startTime: "07:00", endTime: "08:00", elapsed: true }),
                ],
            }),
        );
        expect(board.blocks.map((b) => b.id)).toEqual(["morning", "afternoon"]);
    });

    it("maps tasks and unschedulable reasons onto the board", () => {
        const board = boardFromProposal(
            proposal({
                blocks: [block({ blockId: "m", startTime: "09:00", endTime: "11:00", tasks: [task("t1", 30)] })],
                unschedulable: [{ taskId: "u1", title: "Overflow", estimatedMins: 60, remainingMins: 45, reason: "No room" }],
            }),
        );
        expect(board.blocks[0].tasks).toEqual([{ id: "t1", title: "t1", remainingMins: 30 }]);
        expect(board.unscheduled).toEqual([{ id: "u1", title: "Overflow", remainingMins: 45, reason: "No room" }]);
    });
});

describe("blockRemainingMins", () => {
    it("returns capacity minus used minutes", () => {
        const [m] = boardFromProposal(
            proposal({ blocks: [block({ blockId: "m", startTime: "09:00", endTime: "11:00", tasks: [task("t1", 30), task("t2", 45)] })] }),
        ).blocks;
        expect(blockRemainingMins(m)).toBe(120 - 75);
    });

    it("goes negative when the block is overfilled", () => {
        const [m] = boardFromProposal(
            proposal({ blocks: [block({ blockId: "m", startTime: "09:00", endTime: "10:00", tasks: [task("t1", 90)] })] }),
        ).blocks;
        expect(blockRemainingMins(m)).toBe(-30);
    });
});

describe("moveTask", () => {
    const board: ReviewBoard = {
        blocks: [
            { id: "a", name: "A", startTime: "09:00", endTime: "11:00", energyLevel: null, tasks: [{ id: "t1", title: "T1", remainingMins: 30 }] },
            { id: "b", name: "B", startTime: "13:00", endTime: "15:00", energyLevel: null, tasks: [{ id: "t2", title: "T2", remainingMins: 20 }] },
        ],
        unscheduled: [{ id: "u1", title: "U1", remainingMins: 15, reason: "No room" }],
    };

    it("appends the task to the end of the target block", () => {
        const next = moveTask(board, "t1", blockZone("a"), blockZone("b"));
        expect(next.blocks.find((x) => x.id === "a")!.tasks).toEqual([]);
        expect(next.blocks.find((x) => x.id === "b")!.tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
    });

    it("demotes a scheduled task to unscheduled, dropping its reason", () => {
        const next = moveTask(board, "t1", blockZone("a"), UNSCHEDULED);
        expect(next.blocks.find((x) => x.id === "a")!.tasks).toEqual([]);
        expect(next.unscheduled.map((t) => t.id)).toEqual(["u1", "t1"]);
        expect(next.unscheduled.find((t) => t.id === "t1")!.reason).toBeNull();
    });

    it("rescues an unscheduled task into a block", () => {
        const next = moveTask(board, "u1", UNSCHEDULED, blockZone("a"));
        expect(next.unscheduled).toEqual([]);
        expect(next.blocks.find((x) => x.id === "a")!.tasks.map((t) => t.id)).toEqual(["t1", "u1"]);
    });

    it("is a no-op when source and target are the same zone", () => {
        expect(moveTask(board, "t1", blockZone("a"), blockZone("a"))).toBe(board);
    });

    it("is a no-op when the task isn't in the source zone", () => {
        expect(moveTask(board, "ghost", blockZone("a"), blockZone("b"))).toBe(board);
    });

    it("never mutates the input board", () => {
        const snapshot = JSON.stringify(board);
        moveTask(board, "t1", blockZone("a"), blockZone("b"));
        expect(JSON.stringify(board)).toBe(snapshot);
    });
});

describe("eligibleTargets", () => {
    const board: ReviewBoard = {
        blocks: [
            { id: "a", name: "A", startTime: "09:00", endTime: "11:00", energyLevel: null, tasks: [{ id: "t1", title: "T1", remainingMins: 30 }] },
            { id: "b", name: "B", startTime: "13:00", endTime: "14:00", energyLevel: null, tasks: [{ id: "t2", title: "T2", remainingMins: 90 }] },
            { id: "c", name: "C", startTime: "15:00", endTime: "16:00", energyLevel: null, tasks: [] },
        ],
        unscheduled: [{ id: "u1", title: "U1", remainingMins: 90, reason: null }],
    };

    it("offers the other blocks plus Not scheduled, excluding the current block", () => {
        const targets = eligibleTargets(board, "t1", blockZone("a"));
        expect(targets).toEqual([
            { kind: "block", id: "b", name: "B", startTime: "13:00", endTime: "14:00", remainingAfterMoveMins: -60 },
            { kind: "block", id: "c", name: "C", startTime: "15:00", endTime: "16:00", remainingAfterMoveMins: 30 },
            { kind: "unscheduled" },
        ]);
    });

    it("reports capacity as it would be after the move, so a block with room the task would overflow reads as over", () => {
        const target = eligibleTargets(board, "u1", UNSCHEDULED).find((t) => t.kind === "block" && t.id === "c");
        expect(target).toMatchObject({ remainingAfterMoveMins: -30 });
    });

    it("still offers blocks that are already over capacity", () => {
        const target = eligibleTargets(board, "t1", blockZone("a")).find((t) => t.kind === "block" && t.id === "b");
        expect(target).toMatchObject({ remainingAfterMoveMins: -60 });
    });

    it("does not offer Not scheduled to a task that's already unscheduled", () => {
        const targets = eligibleTargets(board, "u1", UNSCHEDULED);
        expect(targets.every((t) => t.kind === "block")).toBe(true);
        expect(targets.map((t) => (t.kind === "block" ? t.id : "x"))).toEqual(["a", "b", "c"]);
    });
});

describe("planFromProposalAndBoard", () => {
    it("echoes every proposal block — events and elapsed included — with container placements from the board", () => {
        const p = proposal({
            blocks: [
                block({ blockId: "past", startTime: "07:00", endTime: "08:00", elapsed: true }),
                block({ blockId: "lunch", type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" }),
                block({ blockId: "work", startTime: "09:00", endTime: "11:00", energyLevel: "HIGH", tasks: [task("t1", 30)] }),
            ],
        });
        const board = boardFromProposal(p);
        const moved = moveTask(board, "t1", blockZone("work"), UNSCHEDULED);
        const plan = planFromProposalAndBoard(p, moved);

        expect(plan.blocks.map((b) => b.id)).toEqual(["past", "lunch", "work"]);
        // Events carry no taskIds; the demoted container is now empty.
        expect(plan.blocks.find((b) => b.id === "lunch")).not.toHaveProperty("taskIds");
        expect(plan.blocks.find((b) => b.id === "work")!.taskIds).toEqual([]);
    });

    it("assigns elapsed CONTAINER blocks an empty taskIds array (they hold no tasks)", () => {
        const p = proposal({
            blocks: [block({ blockId: "past", startTime: "07:00", endTime: "08:00", elapsed: true })],
        });
        const plan = planFromProposalAndBoard(p, boardFromProposal(p));
        expect(plan.blocks[0].taskIds).toEqual([]);
    });

    it("omits energyLevel when the block has none and preserves the day's wake/sleep", () => {
        const p = proposal({
            wakeTime: "06:30",
            sleepTime: "23:00",
            blocks: [block({ blockId: "work", startTime: "09:00", endTime: "11:00" })],
        });
        const plan = planFromProposalAndBoard(p, boardFromProposal(p));
        expect(plan).toMatchObject({ wakeTime: "06:30", sleepTime: "23:00" });
        expect(plan.blocks[0]).not.toHaveProperty("energyLevel");
    });
});

describe("zones", () => {
    it("zonesEqual matches blocks by id and the unscheduled case to itself", () => {
        expect(zonesEqual(blockZone("a"), blockZone("a"))).toBe(true);
        expect(zonesEqual(blockZone("a"), blockZone("b"))).toBe(false);
        expect(zonesEqual(UNSCHEDULED, UNSCHEDULED)).toBe(true);
        expect(zonesEqual(blockZone("a"), UNSCHEDULED)).toBe(false);
    });

    it("targetZone maps a chosen target back to its zone", () => {
        expect(targetZone({ kind: "block", id: "a", name: "A", startTime: "09:00", endTime: "11:00", remainingAfterMoveMins: 30 })).toEqual(blockZone("a"));
        expect(targetZone({ kind: "unscheduled" })).toEqual(UNSCHEDULED);
    });

    it("round-trips a zone through the accessibility-action encoding", () => {
        expect(zoneFromActionName(zoneToActionName(blockZone("a")))).toEqual(blockZone("a"));
        expect(zoneFromActionName(zoneToActionName(UNSCHEDULED))).toEqual(UNSCHEDULED);
    });
});
