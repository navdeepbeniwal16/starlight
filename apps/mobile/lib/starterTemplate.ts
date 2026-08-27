import { TemplateDraft } from "./templateDraft";

// buildStarterTemplate returns a neutral, valid day for onboarding to pre-seed, so a new
// user edits a real day instead of a blank slate. Block times are spaced to leave visible
// free gaps for Starlight to schedule into.
export function buildStarterTemplate(): TemplateDraft {
    return {
        wakeTime: '07:00',
        sleepTime: '23:00',
        blocks: [
            { type: 'CONTAINER', name: 'Morning Focus', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
            { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            { type: 'CONTAINER', name: 'Afternoon Focus', startTime: '14:00', endTime: '17:00', energyLevel: 'MEDIUM' },
            { type: 'ANCHOR', name: 'Evening Wind-down', startTime: '20:00', endTime: '22:00' },
        ],
    };
}
