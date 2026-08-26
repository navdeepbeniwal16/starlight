import {
    ONBOARDING_STEPS,
    ONBOARDING_STEP_ROUTES,
    TODAY_ROUTE,
    resolveAppEntryRoute,
    previousStepRoute,
} from "./onboardingRouting";

describe("resolveAppEntryRoute", () => {
    it("sends completed users straight to Today", () => {
        expect(resolveAppEntryRoute({ completed: true, furthestStep: null })).toBe(TODAY_ROUTE);
    });

    it("sends completed users to Today regardless of furthest step", () => {
        expect(resolveAppEntryRoute({ completed: true, furthestStep: 'build' })).toBe(TODAY_ROUTE);
    });

    it("sends a brand-new user to the first onboarding step", () => {
        expect(resolveAppEntryRoute({ completed: false, furthestStep: null })).toBe(
            ONBOARDING_STEP_ROUTES.welcome,
        );
    });

    it("resumes an incomplete user at their furthest step", () => {
        for (const step of ONBOARDING_STEPS) {
            expect(resolveAppEntryRoute({ completed: false, furthestStep: step })).toBe(
                ONBOARDING_STEP_ROUTES[step],
            );
        }
    });
});

describe("previousStepRoute", () => {
    it("has no previous step at the cover", () => {
        expect(previousStepRoute('welcome')).toBeNull();
    });

    it("steps back from build to welcome", () => {
        expect(previousStepRoute('build')).toBe(ONBOARDING_STEP_ROUTES.welcome);
    });

    it("steps back from first-task to build", () => {
        expect(previousStepRoute('first-task')).toBe(ONBOARDING_STEP_ROUTES.build);
    });
});
