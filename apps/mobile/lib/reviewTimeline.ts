import type { PlanProposal, ProposalBlock } from "./api.types";
import { toMins } from "./time";

export type ReviewTimelineItem =
    | { kind: "boundary"; label: "Wake" | "Sleep"; time: string }
    | { kind: "block"; block: ProposalBlock; elapsed: boolean }
    | { kind: "gap"; start: string; end: string; elapsed: boolean }
    | { kind: "now" };

// buildReviewTimeline interleaves the proposal's blocks with the gaps between them and a
// now-line, mirroring the Today screen so review reads like the day that follows.
//
// Each block's `elapsed` is trusted as the server set it — the in-progress block is clamped
// to `now` there and intentionally left unelapsed — while gap elapsing and the now-line's
// placement are derived from `now` here.
export function buildReviewTimeline(proposal: PlanProposal, now: string): ReviewTimelineItem[] {
    const items: ReviewTimelineItem[] = [];
    const nowMins = toMins(now);
    const wakeMins = toMins(proposal.wakeTime);
    const sleepMins = toMins(proposal.sleepTime);

    const sorted = [...proposal.blocks].sort((a, b) => toMins(a.startTime) - toMins(b.startTime));

    items.push({ kind: "boundary", label: "Wake", time: proposal.wakeTime });

    let prev = proposal.wakeTime;
    for (const block of sorted) {
        if (toMins(block.startTime) > toMins(prev)) {
            items.push({ kind: "gap", start: prev, end: block.startTime, elapsed: nowMins >= toMins(block.startTime) });
        }
        items.push({ kind: "block", block, elapsed: block.elapsed });
        prev = block.endTime;
    }

    if (toMins(prev) < sleepMins) {
        items.push({ kind: "gap", start: prev, end: proposal.sleepTime, elapsed: nowMins >= sleepMins });
    }

    items.push({ kind: "boundary", label: "Sleep", time: proposal.sleepTime });

    // Insert the now-line just after the last elapsed item, where the day's past meets its
    // future — defaulting to right after Wake when nothing has elapsed yet.
    if (nowMins >= wakeMins && nowMins < sleepMins) {
        let insertAfter = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if ((item.kind === "block" || item.kind === "gap") && item.elapsed) insertAfter = i;
        }
        items.splice(insertAfter + 1, 0, { kind: "now" });
    }

    return items;
}
