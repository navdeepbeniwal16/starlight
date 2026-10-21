import type { DayTemplate } from "./api.types";

export function defaultTemplate(templates: DayTemplate[]): DayTemplate | null {
    if (templates.length === 0) return null;

    const used = templates.filter((t) => t.lastUsedOn != null);
    // ISO date strings sort lexically the same as chronologically, so a plain `>` picks the most recent.
    if (used.length > 0) {
        return used.reduce((best, t) => (t.lastUsedOn! > best.lastUsedOn! ? t : best));
    }
    return templates.reduce((best, t) => (t.updatedAt > best.updatedAt ? t : best));
}

export type TemplateRecency = { label: "Last used"; at: string } | { label: "Updated"; at: string };

export function templateRecency(template: DayTemplate): TemplateRecency {
    return template.lastUsedOn != null
        ? { label: "Last used", at: template.lastUsedOn }
        : { label: "Updated", at: template.updatedAt };
}
