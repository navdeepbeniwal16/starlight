import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import { getAnthropic } from "../lib/anthropic";
import type { BlockType, EnergyLevel, Priority, TaskStatus } from "@prisma/client";

// Thrown when the agent call fails or returns output we can't parse.
export class AgentError extends Error {}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

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
    status: TaskStatus;
};

export type AgentInput = {
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
    status: TaskStatus;
};

// ─── Helpers (independently testable) ────────────────────────────────────

// Shapes the agent input: only CONTAINER blocks are schedulable, and each task's
// remaining work is pre-computed server-side as estimatedMins × (1 − progress/100).
export function buildAgentInput(blocks: RawBlock[], tasks: RawTask[]): AgentInput {
    return {
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
            remainingMins: Math.round(t.estimatedMins * (1 - (t.progress ?? 0) / 100)),
            effort: t.effort,
            priority: t.priority,
            deadline: t.deadline ? t.deadline.toISOString() : null,
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

// ─── Claude invocation ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a scheduling agent for a daily planner. You assign tasks into the available time blocks for the remainder of a user's day.

Rules:
- Only schedule tasks into the CONTAINER blocks you are given. Each block has a startTime, endTime (24h "HH:mm"), and an energyLevel (HIGH, MEDIUM, LOW, or null).
- A task's remainingMins is the work left to do. It must fit entirely within a single block — task splitting across blocks is not supported.
- Batch similar tasks (use the task title and block name for more context) in the same block to avoid context switching as much as possible, or match the task's effort to the block's energyLevel (e.g. HIGH-effort work in HIGH-energy blocks).
- Prioritise in this order: tasks with the most imminent deadline first, then by priority (HIGH > MEDIUM > LOW > none).
- The total remainingMins assigned to a block must not exceed its capacity (endTime − startTime in minutes).
- blockOrder is the 0-based position of a task within its block, reflecting the suggested order of execution.
- If a task cannot fit into any block (its remainingMins exceeds every block's remaining capacity), return it in "unschedulable" with a short human-readable reason. Every task must appear in exactly one of "assignments" or "unschedulable".

Call the submit_schedule tool with your result.`;

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

// Calls Claude with the constructed prompt and returns the raw tool input.
async function callClaude(input: AgentInput): Promise<unknown> {
    let message;
    try {
        message = await getAnthropic().messages.create({
            model: MODEL,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: [SCHEDULE_TOOL],
            tool_choice: { type: "tool", name: "submit_schedule" },
            messages: [{ role: "user", content: JSON.stringify(input) }],
        });
    } catch (err) {
        throw new AgentError(`Agent request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const block = message.content.find(b => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
        throw new AgentError("Agent did not return a tool_use block");
    }
    return block.input;
}

// Dependency seam — lets tests inject a recorded fixture in place of the live call.
export type ScheduleDeps = { callAgent: (input: AgentInput) => Promise<unknown> };
const defaultDeps: ScheduleDeps = { callAgent: callClaude };

// Builds the agent input, invokes the agent, and parses its output.
export async function generateSchedule(
    blocks: RawBlock[],
    tasks: RawTask[],
    deps: ScheduleDeps = defaultDeps,
): Promise<AgentResult> {
    const input = buildAgentInput(blocks, tasks);
    const raw = await deps.callAgent(input);
    return parseAgentResult(raw);
}
