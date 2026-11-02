import { DayTemplate } from "./api.types";
import { TemplateDraft } from "./templateDraft";

export function duplicateName(name: string): string {
    return `${name} copy`;
}

export function buildDuplicateDraft(template: DayTemplate): { name: string; draft: TemplateDraft } {
    return {
        name: duplicateName(template.name),
        draft: {
            wakeTime: template.wakeTime,
            sleepTime: template.sleepTime,
            blocks: template.blocks.map((b) => ({
                type: b.type,
                name: b.name,
                startTime: b.startTime,
                endTime: b.endTime,
                ...(b.energyLevel ? { energyLevel: b.energyLevel } : {}),
            })),
        },
    };
}
