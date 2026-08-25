import { buildStarterTemplate } from "./starterTemplate";
import { computeGaps, hasContainer, isTemplateValid, isWakeBeforeSleep } from "./templateDraft";

describe("buildStarterTemplate", () => {
    it("produces a template that passes the editor's validity check", () => {
        expect(isTemplateValid(buildStarterTemplate())).toBe(true);
    });

    it("has wake before sleep and at least one Container", () => {
        const starter = buildStarterTemplate();
        expect(isWakeBeforeSleep(starter)).toBe(true);
        expect(hasContainer(starter)).toBe(true);
    });

    it("leaves visible free gaps for Starlight to schedule into", () => {
        expect(computeGaps(buildStarterTemplate()).length).toBeGreaterThan(0);
    });
});
