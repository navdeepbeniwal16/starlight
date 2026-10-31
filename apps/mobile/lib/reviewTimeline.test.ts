import type { PlanProposal, ProposalBlock } from "./api.types";
import { buildReviewTimeline, type ReviewTimelineItem } from "./reviewTimeline";

function block(partial: Partial<ProposalBlock> & { blockId: string; startTime: string; endTime: string }): ProposalBlock {
    return {
        type: "CONTAINER",
        name: partial.name ?? partial.blockId,
        energyLevel: null,
        tasks: [],
        elapsed: false,
        ...partial,
    };
}

function proposal(partial: Partial<PlanProposal> & { blocks: ProposalBlock[] }): PlanProposal {
    return {
        wakeTime: "07:00",
        sleepTime: "22:00",
        unschedulable: [],
        ...partial,
    };
}

// A reader's summary of the timeline that's easy to assert against.
function shape(items: ReviewTimelineItem[]): string[] {
    return items.map((item) => {
        switch (item.kind) {
            case "boundary":
                return `boundary:${item.label}`;
            case "block":
                return `block:${item.block.blockId}${item.elapsed ? ":elapsed" : ""}`;
            case "gap":
                return `gap:${item.start}-${item.end}${item.elapsed ? ":elapsed" : ""}`;
            case "now":
                return "now";
        }
    });
}

describe("buildReviewTimeline", () => {
    it("brackets the day with Wake and Sleep boundaries", () => {
        const items = buildReviewTimeline(proposal({ blocks: [] }), "06:00");
        expect(shape(items)).toEqual(["boundary:Wake", "gap:07:00-22:00", "boundary:Sleep"]);
    });

    it("orders blocks chronologically regardless of input order", () => {
        const items = buildReviewTimeline(
            proposal({
                blocks: [
                    block({ blockId: "afternoon", startTime: "13:00", endTime: "15:00" }),
                    block({ blockId: "morning", startTime: "09:00", endTime: "11:00" }),
                ],
            }),
            "06:00",
        );
        expect(shape(items)).toEqual([
            "boundary:Wake",
            "gap:07:00-09:00",
            "block:morning",
            "gap:11:00-13:00",
            "block:afternoon",
            "gap:15:00-22:00",
            "boundary:Sleep",
        ]);
    });

    it("emits no gap between abutting blocks", () => {
        const items = buildReviewTimeline(
            proposal({
                wakeTime: "09:00",
                sleepTime: "13:00",
                blocks: [
                    block({ blockId: "a", startTime: "09:00", endTime: "11:00" }),
                    block({ blockId: "b", startTime: "11:00", endTime: "13:00" }),
                ],
            }),
            "08:00",
        );
        expect(shape(items)).toEqual(["boundary:Wake", "block:a", "block:b", "boundary:Sleep"]);
    });

    it("carries each block's elapsed flag through from the proposal", () => {
        const items = buildReviewTimeline(
            proposal({
                blocks: [
                    block({ blockId: "past", startTime: "08:00", endTime: "09:00", elapsed: true }),
                    block({ blockId: "future", startTime: "10:00", endTime: "11:00" }),
                ],
            }),
            "06:00",
        );
        expect(shape(items)).toContain("block:past:elapsed");
        expect(shape(items)).toContain("block:future");
    });

    it("marks a gap elapsed once now is at or past its end", () => {
        const items = buildReviewTimeline(
            proposal({
                blocks: [block({ blockId: "a", startTime: "10:00", endTime: "11:00" })],
            }),
            "09:30",
        );
        // The 07:00–10:00 gap ends at 10:00; at 09:30 it's still upcoming.
        expect(shape(items)).toContain("gap:07:00-10:00");
        expect(shape(items)).not.toContain("gap:07:00-10:00:elapsed");
    });

    it("drops the now-line between the last elapsed item and the first upcoming one", () => {
        const items = buildReviewTimeline(
            proposal({
                blocks: [
                    block({ blockId: "past", startTime: "08:00", endTime: "09:00", elapsed: true }),
                    block({ blockId: "future", startTime: "14:00", endTime: "16:00" }),
                ],
            }),
            "10:00",
        );
        // 08:00–09:00 elapsed; the 09:00–14:00 gap ends at 14:00 so at 10:00 it's upcoming —
        // the now-line lands right after the past block.
        expect(shape(items)).toEqual([
            "boundary:Wake",
            "gap:07:00-08:00:elapsed",
            "block:past:elapsed",
            "now",
            "gap:09:00-14:00",
            "block:future",
            "gap:16:00-22:00",
            "boundary:Sleep",
        ]);
    });

    it("places the now-line right after Wake when nothing has elapsed yet", () => {
        const items = buildReviewTimeline(
            proposal({
                blocks: [block({ blockId: "a", startTime: "10:00", endTime: "11:00" })],
            }),
            "07:30",
        );
        expect(shape(items).slice(0, 2)).toEqual(["boundary:Wake", "now"]);
    });

    it("omits the now-line before the day begins", () => {
        const items = buildReviewTimeline(
            proposal({ blocks: [block({ blockId: "a", startTime: "10:00", endTime: "11:00" })] }),
            "06:30",
        );
        expect(shape(items)).not.toContain("now");
    });

    it("omits the now-line once the day is over", () => {
        const items = buildReviewTimeline(
            proposal({ blocks: [block({ blockId: "a", startTime: "10:00", endTime: "11:00", elapsed: true })] }),
            "22:30",
        );
        expect(shape(items)).not.toContain("now");
    });
});
