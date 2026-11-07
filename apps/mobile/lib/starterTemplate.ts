import { TemplateDraft } from "./templateDraft";

// The seed name for a user's first template, matching the server-side migration
// that backfilled existing single templates.
export const DEFAULT_TEMPLATE_NAME = 'My Day';

// buildStarterTemplate returns a neutral, valid day for onboarding to pre-seed, so a new
// user edits a real day instead of a blank slate. Block times are spaced to leave visible
// free gaps for Starlight to schedule into.
export function buildStarterTemplate(): TemplateDraft {
    return {
        wakeTime: '06:30',
        sleepTime: '22:30',
        blocks: [
            { type: 'ANCHOR', name: 'Morning Routine', startTime: '06:30', endTime: '07:30' },
            { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
            { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            { type: 'CONTAINER', name: 'Client Work', startTime: '14:00', endTime: '16:30', energyLevel: 'MEDIUM' },
            { type: 'ANCHOR', name: 'Dinner', startTime: '18:30', endTime: '19:30' },
            { type: 'ANCHOR', name: 'Evening Walk', startTime: '20:00', endTime: '20:30' },
            { type: 'ANCHOR', name: 'Evening Wind-down', startTime: '21:00', endTime: '22:00' },
        ],
    };
}

export function buildBlankTemplate(): TemplateDraft {
    return {
        wakeTime: '06:00',
        sleepTime: '22:00',
        blocks: []
    };
}
