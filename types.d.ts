import { EventEmitter } from 'node:events';

// ── Browser ─────────────────────────────────────────────────────────────

export interface BrowserOptions {
  /** Run Chrome in headless mode (default: true) */
  headless?: boolean;
  /** Copy Chrome profile for cookies/logins (default: false) */
  useProfile?: boolean;
  /** CDP debugging port (random by default) */
  port?: number;
}

export declare class Browser extends EventEmitter {
  constructor(opts?: BrowserOptions);

  /** Launch Chrome and connect via CDP */
  launch(): Promise<this>;

  /** Get optimized ARIA snapshot of the current page */
  getSnapshot(): Promise<string>;

  /** Get raw ARIA snapshot without optimization */
  getRawSnapshot(): Promise<{ snapshot: string; refMap: Map<string, number> }>;

  /** Navigate to a URL */
  navigate(url: string): Promise<string>;

  /** Click an element by ref ID (e.g. "e5") */
  clickRef(ref: string): Promise<string>;

  /** Fill a textbox by ref ID */
  fillRef(ref: string, text: string): Promise<string>;

  /** Hover over an element by ref ID */
  hover(ref: string): Promise<string>;

  /** Select an option from a dropdown by ref ID */
  selectOption(ref: string, value: string): Promise<string>;

  /** Wait for a CSS selector to appear */
  waitForSelector(selector: string, timeout?: number): Promise<boolean>;

  /** Click at pixel coordinates */
  click(x: number, y: number): Promise<string>;

  /** Type text character by character */
  type(text: string): Promise<string>;

  /** Press a special key */
  pressKey(key: string): Promise<string>;

  /** Scroll the page */
  scroll(x: number, y: number, deltaX?: number, deltaY?: number): Promise<string>;

  /** Take a PNG screenshot (base64) */
  screenshot(): Promise<string>;

  /** Extract all visible text from the page */
  extractText(): Promise<string>;

  /** Get current page URL */
  getURL(): Promise<string>;

  /** Evaluate JavaScript in the page */
  evaluate(expression: string): Promise<any>;

  /** Close the browser */
  close(): Promise<void>;

  // Events
  on(event: 'launch', listener: () => void): this;
  on(event: 'navigate', listener: (url: string) => void): this;
  on(event: 'action', listener: (action: { type: string; ref?: string; x?: number; y?: number; text?: string; value?: string }) => void): this;
  on(event: 'snapshot', listener: (snapshot: string) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

/** Find Chrome/Chromium binary on the system */
export declare function findChrome(): string | null;

// ── Agent ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{
    id?: string;
    name: string;
    arguments: Record<string, any>;
  }>;
  tool_calls?: Array<{
    id?: string;
    name: string;
    arguments: Record<string, any>;
  }>;
  usage?: {
    input?: number;
    output?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ChatFunction {
  (messages: ChatMessage[], opts: { tools: any[]; maxTokens: number }): Promise<ChatResponse>;
}

export interface BrowseWebOptions {
  /** LLM chat function (required) */
  chat: ChatFunction;
  /** Run Chrome headless (default: true) */
  headless?: boolean;
  /** Copy Chrome profile (default: false) */
  useProfile?: boolean;
  /** CDP port */
  port?: number;
  /** Max agent steps (default: 25) */
  maxSteps?: number;
  /** Step callback */
  onStep?: (step: StepEntry) => void;
}

export interface StepEntry {
  step: number;
  action: string;
  ref: string | null;
  text: string | null;
  result: string;
}

export interface BrowseWebResult {
  result: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
  };
  steps: StepEntry[];
}

/** Run a browser task with an LLM-driven agent */
export declare function browseWeb(url: string, task: string, opts: BrowseWebOptions): Promise<BrowseWebResult>;

// ── Snapshot Optimizer ──────────────────────────────────────────────────

export interface OptimizeOptions {
  maxItems?: number;
  maxNameLength?: number;
  visibleRefs?: Set<string>;
  interactiveOnly?: boolean;
}

export declare function optimizeAll(snapshot: string, options?: OptimizeOptions): string;
export declare function openclawBaseline(snapshot: string): string;
export declare function stripChrome(snapshot: string): string;
export declare function pruneAttributes(snapshot: string): string;
export declare function dedupLinks(snapshot: string): string;
export declare function collapseRedundantChildren(snapshot: string): string;
export declare function truncateLongNames(snapshot: string, opts?: { maxNameLength?: number }): string;
export declare function removeNoise(snapshot: string): string;
export declare function semanticCompress(snapshot: string): string;
export declare function smartTruncate(snapshot: string, opts?: { maxItems?: number }): string;
export declare function viewportOnly(snapshot: string, visibleRefs: Set<string>): string;
export declare function interactiveOnly(snapshot: string): string;
export declare function analyzeWaste(snapshot: string): Record<string, any>;
export declare function countRefsInSnapshot(snapshot: string): number;

// ── Snapshot Differ ─────────────────────────────────────────────────────

export interface DiffResult {
  diff: string;
  stats: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    total: number;
    diffRatio: number;
  };
  isLargeDiff: boolean;
  isEmpty: boolean;
}

export declare function computeDiff(prevSnapshot: string, currSnapshot: string, prevUrl: string, currUrl: string): DiffResult;
export declare function formatActionHistory(history: Array<{ action: string; ref?: string; text?: string; result: string }>): string;
