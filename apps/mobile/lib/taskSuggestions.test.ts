import { matchCategory, selectTaskSuggestions } from "./taskSuggestions";

const titles = (names: string[], pool: string[] = []) =>
    selectTaskSuggestions(names, pool).map((s) => s.title);

describe("matchCategory", () => {
    it("matches a keyword as a case-insensitive substring", () => {
        expect(matchCategory("Deep Work")).toBe("focus");
        expect(matchCategory("INBOX zero")).toBe("admin");
    });

    it("returns null when no keyword matches", () => {
        expect(matchCategory("Meditation")).toBeNull();
    });

    it("lets the longest matching keyword win on a multi-keyword name", () => {
        // "Networking" contains both `network` and `work`.
        expect(matchCategory("Networking")).toBe("network");
        // "Side project" contains both `side project` and `project`.
        expect(matchCategory("Side project")).toBe("creative");
    });
});

describe("selectTaskSuggestions", () => {
    it("maps a single matched block to its category's first suggestion", () => {
        expect(titles(["Deep Work"])).toEqual([
            "Work on my main project",
            // fallback tops up the remaining two slots
            "Reply to messages",
            "Book that appointment",
        ]);
    });

    it("honours longest-keyword-wins when selecting", () => {
        expect(selectTaskSuggestions(["Networking"], [])[0].title).toBe(
            "Message someone I've lost touch with",
        );
    });

    it("drops a duplicate block instead of advancing its list, then tops up from fallback", () => {
        // Day order [Focus, Email, Focus]: block 3 repeats block 1's suggestion,
        // is dropped (not advanced), so fallback fills the third slot.
        expect(titles(["Focus", "Email", "Focus"])).toEqual([
            "Work on my main project",
            "Clear my inbox",
            "Reply to messages",
        ]);
    });

    it("excludes suggestions whose title is already in the pool", () => {
        // The block's suggestion and the matching fallback entry both collide
        // with the pool, so neither appears; the other fallbacks fill in.
        expect(titles(["Deep Work"], ["Work on my main project"])).toEqual([
            "Reply to messages",
            "Book that appointment",
        ]);
    });

    it("falls back to three suggestions when no block matches", () => {
        expect(titles(["Meditation", "Yoga"])).toEqual([
            "Reply to messages",
            "Work on my main project",
            "Book that appointment",
        ]);
    });

    it("falls back when there are no blocks at all", () => {
        expect(titles([])).toEqual([
            "Reply to messages",
            "Work on my main project",
            "Book that appointment",
        ]);
    });

    it("never returns more than three suggestions", () => {
        expect(titles(["Study", "Client work", "Job hunt", "Errands"])).toHaveLength(3);
    });
});
