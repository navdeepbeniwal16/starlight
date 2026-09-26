// Token gate so out-of-order async responses can't clobber fresher state: only the
// most recently issued token is current(). Shared by any screen that fires a fetch
// on focus while optimistic edits may be in flight.
export type Sequencer = { next: () => number; isCurrent: (token: number) => boolean };

export function createSequencer(): Sequencer {
    let latest = 0;
    return {
        next: () => ++latest,
        isCurrent: (token: number) => token === latest,
    };
}
