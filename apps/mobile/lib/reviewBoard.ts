import type { ConfirmBlock, ConfirmPlan, EnergyLevel, PlanProposal } from "./api.types";
import { toMins } from "./time";

// A task lives in exactly one zone: an upcoming CONTAINER block (by id) or the unscheduled
// list. A tagged union keeps the unscheduled case distinct from a block id, so no caller has
// to reserve a magic string.
export type Zone = { kind: "block"; blockId: string } | { kind: "unscheduled" };

export const UNSCHEDULED: Zone = { kind: "unscheduled" };
export const blockZone = (blockId: string): Zone => ({ kind: "block", blockId });

export function zonesEqual(a: Zone, b: Zone): boolean {
    return a.kind === "unscheduled" ? b.kind === "unscheduled" : b.kind === "block" && a.blockId === b.blockId;
}

export type ReviewTask = { id: string; title: string; remainingMins: number };

export type ReviewBlock = {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
    tasks: ReviewTask[];
};

export type UnscheduledTask = ReviewTask & { reason: string | null };

// The editable task placement during review. It holds only the zones a task can live
// in — upcoming (non-elapsed) CONTAINER blocks plus the unscheduled list. Events and
// elapsed blocks aren't task zones, so they render from the proposal, not the board.
export type ReviewBoard = {
    blocks: ReviewBlock[];
    unscheduled: UnscheduledTask[];
};

// Block ids are the proposal's template block ids — the only stable keys shared with
// confirm, since the proposal is never persisted.
export function boardFromProposal(proposal: PlanProposal): ReviewBoard {
    return {
        blocks: proposal.blocks
            .filter((b) => b.type === "CONTAINER" && !b.elapsed)
            .sort((a, b) => toMins(a.startTime) - toMins(b.startTime))
            .map((b) => ({
                id: b.blockId,
                name: b.name,
                startTime: b.startTime,
                endTime: b.endTime,
                energyLevel: b.energyLevel,
                tasks: b.tasks.map((t) => ({ id: t.id, title: t.title, remainingMins: t.remainingMins })),
            })),
        unscheduled: proposal.unschedulable.map((u) => ({
            id: u.taskId,
            title: u.title,
            remainingMins: u.remainingMins,
            reason: u.reason,
        })),
    };
}

export function blockRemainingMins(block: ReviewBlock): number {
    const capacity = toMins(block.endTime) - toMins(block.startTime);
    const used = block.tasks.reduce((sum, t) => sum + t.remainingMins, 0);
    return capacity - used;
}

// Pure — never mutates the input board. Appends the moved task to the target's end. A no-op
// (same zone, or the task isn't in the source) returns the board unchanged.
export function moveTask(board: ReviewBoard, taskId: string, from: Zone, to: Zone): ReviewBoard {
    if (zonesEqual(from, to)) return board;

    let moved: ReviewTask | undefined;
    if (from.kind === "unscheduled") {
        const item = board.unscheduled.find((t) => t.id === taskId);
        if (item) moved = { id: item.id, title: item.title, remainingMins: item.remainingMins };
    } else {
        moved = board.blocks.find((b) => b.id === from.blockId)?.tasks.find((t) => t.id === taskId);
    }
    if (!moved) return board;
    const task = moved;

    const blocks = board.blocks.map((b) => {
        if (from.kind === "block" && b.id === from.blockId) return { ...b, tasks: b.tasks.filter((t) => t.id !== taskId) };
        if (to.kind === "block" && b.id === to.blockId) return { ...b, tasks: [...b.tasks, task] };
        return b;
    });

    let unscheduled = board.unscheduled;
    if (from.kind === "unscheduled") unscheduled = unscheduled.filter((t) => t.id !== taskId);
    if (to.kind === "unscheduled") unscheduled = [...unscheduled, { ...task, reason: null }];

    return { blocks, unscheduled };
}

export type MoveTarget =
    | { kind: "block"; id: string; name: string; startTime: string; endTime: string; remainingAfterMoveMins: number }
    | { kind: "unscheduled" };

// Capacity is reported as it would stand after the move: a block with room left can still be
// overflowed by the incoming task, and that's what the user is deciding. Over-capacity blocks
// are deliberately still offered — their negative value lets the caller annotate "over by".
// Events and elapsed blocks never appear: they aren't in the board to begin with.
export function eligibleTargets(board: ReviewBoard, taskId: string, from: Zone): MoveTarget[] {
    const source = from.kind === "unscheduled" ? board.unscheduled : board.blocks.find((b) => b.id === from.blockId)?.tasks;
    const taskMins = source?.find((t) => t.id === taskId)?.remainingMins ?? 0;

    const targets: MoveTarget[] = board.blocks
        .filter((b) => from.kind !== "block" || b.id !== from.blockId)
        .map((b) => ({
            kind: "block",
            id: b.id,
            name: b.name,
            startTime: b.startTime,
            endTime: b.endTime,
            remainingAfterMoveMins: blockRemainingMins(b) - taskMins,
        }));
    if (from.kind !== "unscheduled") targets.push({ kind: "unscheduled" });
    return targets;
}

export function targetZone(target: MoveTarget): Zone {
    return target.kind === "block" ? blockZone(target.id) : UNSCHEDULED;
}

// React Native's accessibilityAction names must be plain strings, so a Zone is encoded to a
// stable token at that boundary and decoded back when the action fires.
export function zoneToActionName(zone: Zone): string {
    return zone.kind === "unscheduled" ? "unscheduled" : `block:${zone.blockId}`;
}

export function zoneFromActionName(name: string): Zone {
    return name === "unscheduled" ? UNSCHEDULED : blockZone(name.slice("block:".length));
}

// The proposal owns the day's blocks — all of them, elapsed and events included — while
// the board only re-orders the tasks of upcoming CONTAINER blocks. Confirm echoes every
// proposal block so the persisted plan is the full wake→sleep day the user reviewed.
export function planFromProposalAndBoard(proposal: PlanProposal, board: ReviewBoard): ConfirmPlan {
    return {
        wakeTime: proposal.wakeTime,
        sleepTime: proposal.sleepTime,
        blocks: proposal.blocks.map((b): ConfirmBlock => {
            const base: ConfirmBlock = {
                id: b.blockId,
                type: b.type,
                name: b.name,
                startTime: b.startTime,
                endTime: b.endTime,
                ...(b.energyLevel ? { energyLevel: b.energyLevel } : {}),
            };
            if (b.type !== "CONTAINER") return base;
            const placed = board.blocks.find((bl) => bl.id === b.blockId);
            return { ...base, taskIds: placed ? placed.tasks.map((t) => t.id) : [] };
        }),
    };
}
