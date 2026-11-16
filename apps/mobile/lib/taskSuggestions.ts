export type TaskSuggestion = { title: string; estimatedMins: number };

const CATEGORY_SUGGESTIONS = {
    focus: [
        { title: 'Work on my main project', estimatedMins: 120 },
        { title: 'Finish the first version', estimatedMins: 60 },
        { title: 'Plan out the week', estimatedMins: 30 },
    ],
    admin: [
        { title: 'Clear my inbox', estimatedMins: 30 },
        { title: 'Pay my bills', estimatedMins: 15 },
        { title: 'Book that appointment', estimatedMins: 15 },
    ],
    study: [
        { title: "Review this week's notes", estimatedMins: 60 },
        { title: 'Work on my assignment', estimatedMins: 120 },
        { title: 'Do practice questions', estimatedMins: 60 },
    ],
    client: [
        { title: 'Confirm weekly deliverables', estimatedMins: 60 },
        { title: 'Send an invoice', estimatedMins: 15 },
        { title: 'Prep for the client call', estimatedMins: 30 },
    ],
    job: [
        { title: 'Follow up with recruiter', estimatedMins: 15 },
        { title: 'Tailor my resume', estimatedMins: 30 },
        { title: 'Prep for my interview', estimatedMins: 90 },
    ],
    errand: [
        { title: 'Grocery shop', estimatedMins: 60 },
        { title: 'Call the bank', estimatedMins: 15 },
        { title: 'Sort the laundry', estimatedMins: 30 },
    ],
    network: [
        { title: "Message someone I've lost touch with", estimatedMins: 15 },
        { title: 'Update my LinkedIn', estimatedMins: 30 },
    ],
    creative: [
        { title: 'Work on my side project', estimatedMins: 60 },
        { title: 'Jot down new ideas', estimatedMins: 30 },
    ],
} satisfies Record<string, TaskSuggestion[]>;

export type SuggestionCategory = keyof typeof CATEGORY_SUGGESTIONS;

const KEYWORDS: { keyword: string; category: SuggestionCategory }[] = [
    { keyword: 'focus', category: 'focus' },
    { keyword: 'deep', category: 'focus' },
    { keyword: 'work', category: 'focus' },
    { keyword: 'project', category: 'focus' },
    { keyword: 'admin', category: 'admin' },
    { keyword: 'email', category: 'admin' },
    { keyword: 'inbox', category: 'admin' },
    { keyword: 'study', category: 'study' },
    { keyword: 'uni', category: 'study' },
    { keyword: 'class', category: 'study' },
    { keyword: 'revision', category: 'study' },
    { keyword: 'exam', category: 'study' },
    { keyword: 'client', category: 'client' },
    { keyword: 'freelance', category: 'client' },
    { keyword: 'job', category: 'job' },
    { keyword: 'application', category: 'job' },
    { keyword: 'career', category: 'job' },
    { keyword: 'errand', category: 'errand' },
    { keyword: 'personal', category: 'errand' },
    { keyword: 'home', category: 'errand' },
    { keyword: 'life', category: 'errand' },
    { keyword: 'network', category: 'network' },
    { keyword: 'outreach', category: 'network' },
    { keyword: 'side project', category: 'creative' },
    { keyword: 'creative', category: 'creative' },
];

const FALLBACK: TaskSuggestion[] = [
    { title: 'Reply to messages', estimatedMins: 15 },
    { title: 'Work on my main project', estimatedMins: 120 },
    { title: 'Book that appointment', estimatedMins: 15 },
];

const MAX_SUGGESTIONS = 3;

export function matchCategory(blockName: string): SuggestionCategory | null {
    const name = blockName.toLowerCase();
    let best: { keyword: string; category: SuggestionCategory } | null = null;
    for (const entry of KEYWORDS) {
        if (name.includes(entry.keyword) && (!best || entry.keyword.length > best.keyword.length)) {
            best = entry;
        }
    }
    return best?.category ?? null;
}

// On a duplicate (already chosen, or already in `poolTitles`) the block drops
// out rather than advancing to its category's next entry.
export function selectTaskSuggestions(blockNames: string[], poolTitles: string[]): TaskSuggestion[] {
    const taken = new Set(poolTitles.map((t) => t.trim()));
    const selected: TaskSuggestion[] = [];

    const tryAdd = (s: TaskSuggestion) => {
        if (selected.length >= MAX_SUGGESTIONS || taken.has(s.title)) return;
        taken.add(s.title);
        selected.push(s);
    };

    for (const name of blockNames) {
        if (selected.length >= MAX_SUGGESTIONS) break;
        const category = matchCategory(name);
        if (category) tryAdd(CATEGORY_SUGGESTIONS[category][0]);
    }

    for (const s of FALLBACK) tryAdd(s);

    return selected;
}
