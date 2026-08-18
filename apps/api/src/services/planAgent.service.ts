import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import { getAnthropic } from "../lib/anthropic";
import logger from "../lib/logger";
import type { BlockType, EnergyLevel, Priority, TaskStatus } from "@prisma/client";

// Thrown when the agent call fails or returns output we can't parse.
export class AgentError extends Error { }

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

export const CAPACITY_TOLERANCE_MINS = 15;

// 2 retries after the first call = 3 model calls total.
export const MAX_REPLAN_ATTEMPTS = 2;

export const FLOOR_EVICTION_REASON = "There wasn't enough time to fit this in a block.";

// ─── Agent input/output shapes ────────────────────────────────────────────────

// A CONTAINER block the agent may schedule into.
export type AgentBlock = {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
};

// A schedulable task with server-computed remaining work.
export type AgentTask = {
    id: string;
    title: string;
    remainingMins: number;
    effort: EnergyLevel | null;
    priority: Priority | null;
    deadline: string | null;
    notes: string | null;
    createdAt: string;
    status: TaskStatus;
};

export type AgentInput = {
    now: string;
    blocks: AgentBlock[];
    tasks: AgentTask[];
};

export type Assignment = { taskId: string; blockId: string; blockOrder: number };
export type Unschedulable = { taskId: string; reason: string };
export type AgentResult = { assignments: Assignment[]; unschedulable: Unschedulable[] };

// The raw data type this service accepts before agent-input shaping.
export type RawBlock = {
    id: string;
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
};

export type RawTask = {
    id: string;
    title: string;
    estimatedMins: number;
    progress: number | null;
    effort: EnergyLevel | null;
    priority: Priority | null;
    deadline: Date | null;
    notes: string | null;
    createdAt: Date;
    status: TaskStatus;
};

// ─── Helpers (independently testable) ────────────────────────────────────

/**
 * Work left on a task: its estimate scaled down by how far it's progressed.
 *
 * @param estimatedMins - The task's full time estimate, in minutes.
 * @param progress - Completion percentage (0–100), or null (treated as 0).
 * @returns Remaining minutes, rounded to the nearest integer.
 */
export function remainingMinsOf(estimatedMins: number, progress: number | null): number {
    return Math.round(estimatedMins * (1 - (progress ?? 0) / 100));
}

// Shapes the agent input: only CONTAINER blocks are schedulable, and each task's
// remaining work is pre-computed server-side as estimatedMins × (1 − progress/100).
export function buildAgentInput(blocks: RawBlock[], tasks: RawTask[], now: string): AgentInput {
    return {
        now,
        blocks: blocks
            .filter(b => b.type === "CONTAINER")
            .map(b => ({
                id: b.id,
                name: b.name,
                startTime: b.startTime,
                endTime: b.endTime,
                energyLevel: b.energyLevel,
            })),
        tasks: tasks.map(t => ({
            id: t.id,
            title: t.title,
            remainingMins: remainingMinsOf(t.estimatedMins, t.progress),
            effort: t.effort,
            priority: t.priority,
            deadline: t.deadline ? t.deadline.toISOString() : null,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
            status: t.status,
        })),
    };
}

const resultSchema = z.object({
    assignments: z.array(
        z.object({
            taskId: z.string(),
            blockId: z.string(),
            blockOrder: z.number().int(),
        }),
    ),
    unschedulable: z.array(
        z.object({
            taskId: z.string(),
            reason: z.string(),
        }),
    ),
});

// Validates and narrows the agent's raw structured output.
export function parseAgentResult(raw: unknown): AgentResult {
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) {
        throw new AgentError(`Agent returned malformed output: ${parsed.error.message}`);
    }
    return parsed.data;
}

/**
 * Prunes the agent's assignments down to a trustworthy set: those referencing a
 * real CONTAINER block and a real task, with each task placed at most once.
 *
 * The model can hallucinate block/task ids or place a task twice; downstream
 * capacity and display logic want a single authoritative set to reason about, so
 * normalization lives here rather than being re-derived at each consumer. Pure —
 * `unschedulable` is passed through untouched.
 *
 * @param result - The parsed agent output.
 * @param containerBlockIds - Ids of blocks that are valid CONTAINER placements.
 * @param taskIds - Ids of the tasks that were offered to the agent.
 * @returns A result whose assignments are valid and deduped (first occurrence of
 *          a task wins), preserving each surviving assignment's blockOrder.
 */
export function normalizeAssignments(
    result: AgentResult,
    containerBlockIds: ReadonlySet<string>,
    taskIds: ReadonlySet<string>,
): AgentResult {
    const placed = new Set<string>();
    const assignments = result.assignments.filter(a => {
        if (!containerBlockIds.has(a.blockId) || !taskIds.has(a.taskId) || placed.has(a.taskId)) {
            return false;
        }
        placed.add(a.taskId);
        return true;
    });
    return { assignments, unschedulable: result.unschedulable };
}

// ─── Capacity guardrail ───────────────────────────────────────────────────────

function hhmmToMins(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

// Positive by construction: blocks are pre-validated (start < end) and never wrap midnight.
function capacityOf(block: AgentBlock): number {
    return hhmmToMins(block.endTime) - hhmmToMins(block.startTime);
}

function committedMinsByBlock(
    tasks: AgentTask[],
    assignments: Assignment[],
): Map<string, number> {
    const remainingById = new Map(tasks.map(t => [t.id, t.remainingMins]));
    const committed = new Map<string, number>();
    for (const a of assignments) {
        const mins = remainingById.get(a.taskId) ?? 0;
        committed.set(a.blockId, (committed.get(a.blockId) ?? 0) + mins);
    }
    return committed;
}

// A block committed beyond capacity + tolerance, with its overflow past true capacity.
export type BlockOverflow = {
    blockId: string;
    capacity: number;
    committed: number;
    overflow: number;
};

/**
 * Finds blocks whose committed work exceeds their capacity by more than `tolerance`.
 *
 * Pure. The threshold is `capacity + tolerance` (a block committed exactly to that
 * bound is within tolerance, not over), but the reported `overflow` is measured
 * against true capacity — the honest "how far past what fits" figure that feeds
 * eviction targets and the floor's residual log.
 *
 * @returns One entry per over-capacity block; an empty array means every block fits.
 */
export function overflowsOf(
    blocks: AgentBlock[],
    tasks: AgentTask[],
    assignments: Assignment[],
    tolerance: number,
): BlockOverflow[] {
    const committed = committedMinsByBlock(tasks, assignments);
    const overflows: BlockOverflow[] = [];
    for (const block of blocks) {
        const capacity = capacityOf(block);
        const used = committed.get(block.id) ?? 0;
        const overflow = used - capacity;
        if (overflow > tolerance) {
            overflows.push({ blockId: block.id, capacity, committed: used, overflow });
        }
    }
    return overflows;
}

/**
 * The deterministic floor: trims each over-capacity block until it fits within
 * `capacity + tolerance` by evicting its highest-`blockOrder` tasks first.
 *
 * @returns The surviving assignments and the ids of tasks evicted to make room.
 */
export function evictToFit(
    blocks: AgentBlock[],
    tasks: AgentTask[],
    assignments: Assignment[],
    tolerance: number,
): { assignments: Assignment[]; evicted: string[] } {
    const remainingById = new Map(tasks.map(t => [t.id, t.remainingMins]));
    const capacityById = new Map(blocks.map(b => [b.id, capacityOf(b)]));

    const evicted = new Set<string>();
    const byBlock = new Map<string, Assignment[]>();
    for (const a of assignments) {
        const list = byBlock.get(a.blockId) ?? [];
        list.push(a);
        byBlock.set(a.blockId, list);
    }

    for (const [blockId, placed] of byBlock) {
        const capacity = capacityById.get(blockId) ?? 0;
        let committed = placed.reduce((sum, a) => sum + (remainingById.get(a.taskId) ?? 0), 0);
        const byValueAscending = [...placed].sort((x, y) => y.blockOrder - x.blockOrder);
        for (const a of byValueAscending) {
            if (committed - capacity <= tolerance) break;
            evicted.add(a.taskId);
            committed -= remainingById.get(a.taskId) ?? 0;
        }
    }

    return {
        assignments: assignments.filter(a => !evicted.has(a.taskId)),
        evicted: [...evicted],
    };
}

/**
 * buildOverflowFeedback renders re-plan feedback for over-capacity blocks. It
 * deliberately never discloses the tolerance — the model is told to fit within capacity,
 * so the floor's slack stays private.
 */
export function buildOverflowFeedback(
    blocks: AgentBlock[],
    tasks: AgentTask[],
    assignments: Assignment[],
    tolerance: number,
): string {
    const overflows = overflowsOf(blocks, tasks, assignments, tolerance);
    const nameById = new Map(blocks.map(b => [b.id, b.name]));
    const lines = overflows.map(
        o => `- "${nameById.get(o.blockId) ?? o.blockId}" (${o.blockId}): capacity ${o.capacity} min, assigned ${o.committed} min, over by ${o.overflow} min`,
    );
    return [
        "One or more blocks are scheduled beyond their capacity. Fit each block's assigned work within its capacity.",
        "Prefer moving lower-value tasks to blocks with room, and keep the highest-value tasks scheduled; mark a task unschedulable only as a last resort.",
        "Resubmit the full schedule via submit_schedule.",
        "",
        "Over-capacity blocks:",
        ...lines,
    ].join("\n");
}

// ─── Claude invocation ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a scheduling agent for a daily planner. You assign tasks into the available time blocks for the remainder of a user's day.

Input:
- now: the current instant as an ISO string. It is your anchor — judge how urgent a deadline is and how long a task has waited relative to now.
- blocks: the CONTAINER blocks you may schedule into. Each has a startTime, endTime (24h "HH:mm"), and an energyLevel (HIGH, MEDIUM, LOW, or null).
- tasks: each has a remainingMins (the work left to do), an effort (HIGH, MEDIUM, LOW, or null), a priority (HIGH, MEDIUM, LOW, or null), a deadline (ISO string or null), notes (free-text context from the user, possibly empty), a createdAt (ISO string — when the task was added, so an old createdAt means it has waited a long time), and a status.

Judging value:
- Estimate each task's value by weighing all of its signals together: how close its deadline is relative to now, its priority, what its notes reveal about importance or context, and how long it has waited (tasks sitting in the backlog for a long time should not linger). Balance these signals holistically rather than following any strict ordering of them.
- Schedule so the most valuable work gets a place. When not everything fits, the lower-value tasks are the ones left unscheduled.

Rules:
- Only schedule tasks into the CONTAINER blocks you are given.
- A task's remainingMins must fit entirely within a single block — task splitting across blocks is not supported.
- Batch similar tasks (use the task title, notes, and block name for more context) in the same block to avoid context switching as much as possible, or match the task's effort to the block's energyLevel (e.g. HIGH-effort work in HIGH-energy blocks).
- The total remainingMins assigned to a block must not exceed its capacity (endTime − startTime in minutes).
- blockOrder is the 0-based position of a task within its block, reflecting the suggested order of execution.
- If a task cannot fit into any block (its remainingMins exceeds every block's remaining capacity), return it in "unschedulable" with a short human-readable reason. Every task must appear in exactly one of "assignments" or "unschedulable".

You MUST call the submit_schedule tool on every turn with your complete schedule — including when revising after feedback. Never reply without calling it.`;

const SCHEDULE_TOOL: Anthropic.Tool = {
    name: "submit_schedule",
    description: "Submit the computed task-to-block schedule.",
    input_schema: {
        type: "object",
        properties: {
            assignments: {
                type: "array",
                description: "Tasks placed into a block.",
                items: {
                    type: "object",
                    properties: {
                        taskId: { type: "string" },
                        blockId: { type: "string" },
                        blockOrder: { type: "integer", description: "0-based order within the block." },
                    },
                    required: ["taskId", "blockId", "blockOrder"],
                },
            },
            unschedulable: {
                type: "array",
                description: "Tasks that could not be placed, with a reason.",
                items: {
                    type: "object",
                    properties: {
                        taskId: { type: "string" },
                        reason: { type: "string" },
                    },
                    required: ["taskId", "reason"],
                },
            },
        },
        required: ["assignments", "unschedulable"],
    },
};

// tool_choice stays `auto` because forcing a specific tool is incompatible with
// thinking; the system prompt guarantees the submit_schedule call instead.
// disable_parallel_tool_use keeps each turn to a single tool_use, so the loop's echo of
// the assistant turn is always matched by exactly one tool_result on the next request.
async function callClaude(messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
    try {
        return await getAnthropic().messages.create({
            model: MODEL,
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            system: SYSTEM_PROMPT,
            tools: [SCHEDULE_TOOL],
            tool_choice: { type: "auto", disable_parallel_tool_use: true },
            messages,
        });
    } catch (err) {
        throw new AgentError(`Agent request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// Null (rather than a throw) when the model didn't call submit_schedule — possible under
// tool_choice: auto, and salvaged by the caller instead of being fatal.
function toolUseOf(message: Anthropic.Message): { input: unknown; toolUseId: string } | null {
    const block = message.content.find(b => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return null;
    return { input: block.input, toolUseId: block.id };
}

export type ScheduleDeps = { callModel: (messages: Anthropic.MessageParam[]) => Promise<Anthropic.Message> };
const defaultDeps: ScheduleDeps = { callModel: callClaude };

/**
 * generateSchedule returns a valid, deduplicated, capacity-safe schedule.
 *
 * The model gets up to MAX_REPLAN_ATTEMPTS re-plans to fix overcommitted blocks while
 * preserving high-value work; if it can't converge, the deterministic floor evicts the
 * lowest-valued tasks as a backstop. Either way, no returned block exceeds
 * capacity + tolerance.
 */
export async function generateSchedule(
    blocks: RawBlock[],
    tasks: RawTask[],
    now: string,
    deps: ScheduleDeps = defaultDeps,
): Promise<AgentResult> {
    const input = buildAgentInput(blocks, tasks, now);
    const containerBlockIds = new Set(blocks.filter(b => b.type === "CONTAINER").map(b => b.id));
    const taskIds = new Set(tasks.map(t => t.id));

    // The transcript is the model's holistic view: message[0] holds the full input and
    // each turn is appended, so every re-plan sees the whole day and its own prior plan.
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: JSON.stringify(input) }];

    let normalized: AgentResult | undefined;
    let overflows: BlockOverflow[] = [];

    for (let attempt = 0; ; attempt++) {
        const message = await deps.callModel(messages);

        const toolUse = toolUseOf(message);
        // Under tool_choice: auto the model can answer without calling submit_schedule.
        // Fall back to the best schedule so far and let the floor make it safe; only the
        // very first turn has nothing to salvage, so that alone is unrecoverable.
        if (!toolUse) {
            if (!normalized) throw new AgentError("Agent did not return a tool_use block");
            break;
        }

        normalized = normalizeAssignments(parseAgentResult(toolUse.input), containerBlockIds, taskIds);

        overflows = overflowsOf(input.blocks, input.tasks, normalized.assignments, CAPACITY_TOLERANCE_MINS);
        if (overflows.length === 0) return normalized;
        if (attempt >= MAX_REPLAN_ATTEMPTS) break;

        logger.debug(
            { attempt: attempt + 1, overflows: overflows.map(o => ({ blockId: o.blockId, overflow: o.overflow })) },
            "Re-plan loop: block(s) over capacity, requesting a fresh schedule",
        );

        // The API requires prior thinking blocks to be replayed unchanged, so echo the
        // full response verbatim.
        messages.push({ role: "assistant", content: message.content });
        messages.push({
            role: "user",
            content: [{
                type: "tool_result",
                tool_use_id: toolUse.toolUseId,
                content: buildOverflowFeedback(input.blocks, input.tasks, normalized.assignments, CAPACITY_TOLERANCE_MINS),
            }],
        });
    }

    // Reached only via `break`, which always runs after `normalized` has been assigned.
    const finalSchedule = normalized as AgentResult;
    const { assignments, evicted } = evictToFit(input.blocks, input.tasks, finalSchedule.assignments, CAPACITY_TOLERANCE_MINS);

    // Overrun each floored block still carries past true capacity — now within tolerance
    // (may be ≤ 0). Surfaced in the warn log to show how much slack the floor leaned on.
    const overIds = new Set(overflows.map(o => o.blockId));
    const committedAfter = committedMinsByBlock(input.tasks, assignments);
    const residual = input.blocks
        .filter(b => overIds.has(b.id))
        .map(b => ({ blockId: b.id, overflow: (committedAfter.get(b.id) ?? 0) - capacityOf(b) }));
    logger.warn({ evicted, residual }, "Capacity floor evicted tasks to fit blocks within capacity");

    return {
        assignments,
        unschedulable: [
            ...finalSchedule.unschedulable,
            ...evicted.map(taskId => ({ taskId, reason: FLOOR_EVICTION_REASON })),
        ],
    };
}
