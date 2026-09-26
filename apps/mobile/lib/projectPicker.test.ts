import { TODOS_LABEL, projectPickerOptions, selectedProjectLabel } from "./projectPicker";
import type { Project } from "./api.types";

function project(id: string, over: Partial<Project> = {}): Project {
    return { id, name: id, goal: null, notes: null, isInFocus: false, ...over };
}

describe("projectPickerOptions", () => {
    it("leads with Todos (null id) then one option per project, in order", () => {
        const options = projectPickerOptions([project('a', { name: 'Apollo' }), project('b', { name: 'Beacon' })]);
        expect(options).toEqual([
            { id: null, label: TODOS_LABEL },
            { id: 'a', label: 'Apollo' },
            { id: 'b', label: 'Beacon' },
        ]);
    });

    it("offers Todos alone when there are no projects", () => {
        expect(projectPickerOptions([])).toEqual([{ id: null, label: TODOS_LABEL }]);
    });
});

describe("selectedProjectLabel", () => {
    const projects = [project('a', { name: 'Apollo' }), project('b', { name: 'Beacon' })];

    it("resolves a matching project's name", () => {
        expect(selectedProjectLabel(projects, 'b')).toBe('Beacon');
    });

    it("falls back to Todos for null (unassigned)", () => {
        expect(selectedProjectLabel(projects, null)).toBe(TODOS_LABEL);
    });

    it("falls back to Todos for undefined", () => {
        expect(selectedProjectLabel(projects, undefined)).toBe(TODOS_LABEL);
    });

    // A task can carry a projectId whose project was deleted since (server SetNull races
    // a stale form); the label degrades to Todos rather than showing a blank chip.
    it("falls back to Todos for an unknown id", () => {
        expect(selectedProjectLabel(projects, 'ghost')).toBe(TODOS_LABEL);
    });
});
