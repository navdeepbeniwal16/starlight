import Anthropic from "@anthropic-ai/sdk";

// Lazily constructed so importing modules that reference the client (e.g. for
// types or pure helpers) has no side effects and needs no API key.
let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
    if (!client) client = new Anthropic(); // The key is resolved from ANTHROPIC_API_KEY in env variables
    return client;
}
