import { NONE_LABEL, projectPickerOptions, selectedProjectLabel } from "./projectPicker";
import type { Project } from "./api.types";

function project(id: string, over: Partial<Project> = {}): Project {
    return { id, name: id, goal: null, notes: null, isInFocus: false, ...over };
}

describe("projectPickerOptions", () => {
    it("leads with the None clear option (null id) then one option per project, in order", () => {
        const options = projectPickerOptions([project('a', { name: 'Apollo' }), project('b', { name: 'Beacon' })]);
        expect(options).toEqual([
            { id: null, label: NONE_LABEL },
            { id: 'a', label: 'Apollo' },
            { id: 'b', label: 'Beacon' },
        ]);
    });

    it("offers the None option alone when there are no projects", () => {
        expect(projectPickerOptions([])).toEqual([{ id: null, label: NONE_LABEL }]);
    });
});

describe("selectedProjectLabel", () => {
    const projects = [project('a', { name: 'Apollo' }), project('b', { name: 'Beacon' })];

    it("resolves a matching project's name", () => {
        expect(selectedProjectLabel(projects, 'b')).toBe('Beacon');
    });

    it("reads as None for null (unassigned)", () => {
        expect(selectedProjectLabel(projects, null)).toBe(NONE_LABEL);
    });

    it("reads as None for undefined", () => {
        expect(selectedProjectLabel(projects, undefined)).toBe(NONE_LABEL);
    });

    // A task can carry a projectId whose project was deleted since (server SetNull races
    // a stale form); the label degrades to None rather than showing a blank value.
    it("reads as None for an unknown id", () => {
        expect(selectedProjectLabel(projects, 'ghost')).toBe(NONE_LABEL);
    });
});
