export declare const CLAUDE_CODE_PROVIDER = "claude-code";
/** The current coordinates for a saved model reference: fork-era Claude Code
 *  ids map to their alias; every other provider's id is returned untouched
 *  (the same string can be a real model id elsewhere). */
export declare function canonicalModelRef<T extends {
    provider: string;
    id: string;
}>(ref: T): T;
/** Installation/version only. Never an authentication, quota, or billing verdict. */
export interface ClaudeCodeStatus {
    state: "not-found" | "meets-minimum" | "update-required" | "version-unchecked";
    version: string | null;
    minimumVersion: string;
}
export declare const CLAUDE_CODE_MINIMUM_VERSION = "2.1.259";
