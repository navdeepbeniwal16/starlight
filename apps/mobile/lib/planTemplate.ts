import type { DayShape, DayTemplate, ShapeBlock } from "./api.types";
import type { TemplateDraft } from "./templateDraft";
import { formatRelative, toMins } from "./time";

// Picks the template Step 2 opens on: most recent by last planned-from date (lastUsedOn),
// falling back to most recently edited when none was ever used. Null when the user has none.
export function resolveDefaultTemplate(templates: DayTemplate[]): DayTemplate | null {
    if (templates.length === 0) return null;
    const used = templates.filter((t) => t.lastUsedOn !== null);
    const pool = used.length > 0 ? used : templates;
    const key = used.length > 0
        ? (t: DayTemplate) => t.lastUsedOn ?? ""
        : (t: DayTemplate) => t.updatedAt;
    return pool.reduce((best, t) => (key(t) > key(best) ? t : best));
}

export type RecencyBasis = { kind: "lastUsed"; date: string } | { kind: "updated"; date: string };

// Which instant a template's recency label reads from: when it was last used if ever,
// else when it was last edited. Both are full ISO timestamps, so the formatter can
// speak in real minutes/hours — not the day-granularity lastUsedOn.
export function templateRecencyBasis(template: DayTemplate): RecencyBasis {
    return template.lastUsedAt !== null
        ? { kind: "lastUsed", date: template.lastUsedAt }
        : { kind: "updated", date: template.updatedAt };
}

export function templateRecencyLabel(template: DayTemplate): string {
    const basis = templateRecencyBasis(template);
    const lead = basis.kind === "lastUsed" ? "Last used" : "Updated";
    return `${lead} ${formatRelative(basis.date)}`;
}

// Builds the generate/confirm shape from the editable draft, drawing each block's
// client-stable id from the store's parallel blockKeys array (index-aligned).
export function draftToShape(draft: TemplateDraft, blockKeys: string[]): DayShape {
    return {
        wakeTime: draft.wakeTime,
        sleepTime: draft.sleepTime,
        blocks: draft.blocks.map((b, i): ShapeBlock => ({ ...b, id: blockKeys[i] })),
    };
}

// Builds a shape straight from a stored template, keying blocks off their persisted
// ids. Used where the template is planned from unedited (e.g. onboarding).
export function templateToShape(template: DayTemplate): DayShape {
    return {
        wakeTime: template.wakeTime,
        sleepTime: template.sleepTime,
        blocks: template.blocks.map((b): ShapeBlock => ({
            id: b.id,
            type: b.type,
            name: b.name,
            startTime: b.startTime,
            endTime: b.endTime,
            ...(b.energyLevel ? { energyLevel: b.energyLevel } : {}),
        })),
    };
}

// Whether any CONTAINER block still has time left to plan into today — false when
// none were added or all have already elapsed. `now` is the current HH:mm.
export function hasSchedulableBlock(draft: TemplateDraft | null, now: string): boolean {
    if (!draft) return false;
    const nowMins = toMins(now);
    return draft.blocks.some((b) => b.type === "CONTAINER" && toMins(b.endTime) > nowMins);
}
