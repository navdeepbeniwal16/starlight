import {
    MAX_IN_FOCUS,
    inFocusCount,
    focusCapReached,
    focusToggleBlocked,
    applyCreated,
    replaceProject,
    withoutProject,
    setFocus,
} from "./projectState";
import type { Project } from "./api.types";

function project(id: string, over: Partial<Project> = {}): Project {
    return { id, name: id, goal: null, notes: null, isInFocus: false, ...over };
}

// Builds `count` focused projects plus one unfocused "target" to toggle.
function withFocused(count: number): Project[] {
    const focused = Array.from({ length: count }, (_, i) => project(`f${i}`, { isInFocus: true }));
    return [...focused, project('target')];
}

describe("inFocusCount", () => {
    it("counts only focused projects", () => {
        expect(inFocusCount([project('a', { isInFocus: true }), project('b'), project('c', { isInFocus: true })])).toBe(2);
    });

    it("is zero for an empty list", () => {
        expect(inFocusCount([])).toBe(0);
    });
});

describe("focusCapReached", () => {
    it("is false below the cap", () => {
        expect(focusCapReached(withFocused(MAX_IN_FOCUS - 1))).toBe(false);
    });

    it("is true at the cap", () => {
        expect(focusCapReached(withFocused(MAX_IN_FOCUS))).toBe(true);
    });
});

describe("focusToggleBlocked", () => {
    it("blocks turning on a new project once the cap is full", () => {
        expect(focusToggleBlocked(withFocused(MAX_IN_FOCUS), 'target')).toBe(true);
    });

    it("allows turning on a new project below the cap", () => {
        expect(focusToggleBlocked(withFocused(MAX_IN_FOCUS - 1), 'target')).toBe(false);
    });

    it("always allows turning off an already-focused project, even at the cap", () => {
        const projects = withFocused(MAX_IN_FOCUS);
        expect(focusToggleBlocked(projects, 'f0')).toBe(false);
    });

    it("does not block an unknown id", () => {
        expect(focusToggleBlocked(withFocused(MAX_IN_FOCUS), 'ghost')).toBe(false);
    });
});

describe("applyCreated", () => {
    it("appends the new project last and does not mutate the input", () => {
        const before = [project('a'), project('b')];
        const after = applyCreated(before, project('c'));
        expect(after.map(p => p.id)).toEqual(['a', 'b', 'c']);
        expect(before).toHaveLength(2);
    });
});

describe("replaceProject", () => {
    it("swaps the matching project and leaves the rest, without mutating", () => {
        const before = [project('a', { name: 'Old' }), project('b')];
        const after = replaceProject(before, project('a', { name: 'New' }));
        expect(after.find(p => p.id === 'a')?.name).toBe('New');
        expect(after.find(p => p.id === 'b')?.name).toBe('b');
        expect(before.find(p => p.id === 'a')?.name).toBe('Old');
    });
});

describe("withoutProject", () => {
    it("removes the matching project", () => {
        const after = withoutProject([project('a'), project('b')], 'a');
        expect(after.map(p => p.id)).toEqual(['b']);
    });
});

describe("setFocus", () => {
    it("flips isInFocus for the matching id only, without mutating", () => {
        const before = [project('a'), project('b')];
        const after = setFocus(before, 'a', true);
        expect(after.find(p => p.id === 'a')?.isInFocus).toBe(true);
        expect(after.find(p => p.id === 'b')?.isInFocus).toBe(false);
        expect(before.find(p => p.id === 'a')?.isInFocus).toBe(false);
    });
});
