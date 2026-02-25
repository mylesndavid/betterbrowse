# better-brows

Zero-dependency browser automation via Chrome DevTools Protocol with ARIA accessibility snapshots — 10-100x cheaper than vision-based approaches.

## Why?

Most browser automation agents use screenshots + vision models. That's expensive and slow. `better-brows` uses **ARIA accessibility snapshots** instead — a text representation of the page that any LLM can understand. This means:

- **10-100x cheaper** — text tokens vs image tokens
- **Works with any text model** — no vision model required
- **Faster** — no image encoding/decoding overhead
- **More reliable** — structured data vs pixel interpretation

## Install

```bash
npm install better-brows
```

Requires Node.js >= 20.10.0 and Chrome/Chromium installed locally.

## Quick Start

### Browser Class (Tool Harness)

```js
import { Browser } from 'better-brows';

const browser = new Browser({ headless: true });
await browser.launch();
await browser.navigate('https://example.com');

// Get ARIA snapshot — structured text representation of the page
const snapshot = await browser.getSnapshot();
console.log(snapshot);
// - heading "Example Domain" [ref=e1]
// - text "This domain is for use in illustrative examples..."
// - link "More information..." [ref=e2]

// Interact using refs from the snapshot
await browser.clickRef('e2');

// Take a screenshot
const png = await browser.screenshot(); // base64

await browser.close();
```

### Agent (LLM-Driven Loop)

```js
import { browseWeb } from 'better-brows';

const result = await browseWeb('https://news.ycombinator.com', 'Find the top story title', {
  chat: async (messages, { tools, maxTokens }) => {
    // Wire up your LLM here — OpenAI, Anthropic, Google, etc.
    const response = await yourLLM.chat(messages, { tools, maxTokens });
    return {
      content: response.text,
      toolCalls: response.toolCalls, // [{ name, arguments, id }]
      usage: { input: response.inputTokens, output: response.outputTokens },
    };
  },
});

console.log(result.result);  // "The top story is: ..."
console.log(result.usage);   // { inputTokens, outputTokens, modelCalls }
console.log(result.steps);   // [{ step, action, ref, text, result }, ...]
```

## API

### `Browser`

```js
new Browser({ headless?: boolean, useProfile?: boolean, port?: number })
```

Extends `EventEmitter`. Events: `launch`, `navigate`, `action`, `snapshot`, `close`, `error`.

| Method | Description |
|---|---|
| `launch()` | Start Chrome and connect via CDP |
| `navigate(url)` | Navigate to a URL |
| `getSnapshot()` | Get optimized ARIA snapshot |
| `getRawSnapshot()` | Get raw snapshot + refMap |
| `clickRef(ref)` | Click element by ref (e.g. `"e5"`) |
| `fillRef(ref, text)` | Type into input by ref |
| `hover(ref)` | Mouse hover by ref |
| `selectOption(ref, value)` | Select dropdown option by ref |
| `waitForSelector(selector, timeout?)` | Wait for CSS selector |
| `screenshot()` | Capture PNG (base64) |
| `extractText()` | Get all visible text |
| `evaluate(expr)` | Run JS in page |
| `close()` | Close browser |

### `browseWeb(url, task, opts)`

LLM-driven browser agent. Returns `{ result, usage, steps }`.

**Required option:** `chat` — async function matching:
```ts
(messages, { tools, maxTokens }) => Promise<{ content, toolCalls?, usage? }>
```

### Snapshot Utilities

```js
import { optimizeAll, computeDiff, analyzeWaste } from 'better-brows';

// Optimize a raw ARIA snapshot
const optimized = optimizeAll(rawSnapshot, { maxItems: 10 });

// Compute diff between two snapshots
const diff = computeDiff(prevSnapshot, currSnapshot, prevUrl, currUrl);

// Analyze snapshot waste
const report = analyzeWaste(rawSnapshot);
```

## How ARIA Snapshots Work

Instead of screenshots, we fetch the browser's accessibility tree via CDP and convert it to a compact text format:

```
- heading "Search Results" [ref=e1]
- textbox "Search query" [ref=e2]
- button "Search" [ref=e3]
- list
  - listitem
    - link "First Result" [ref=e4]
  - listitem
    - link "Second Result" [ref=e5]
```

Interactive elements get `[ref=eXX]` tags. The agent uses these refs to click, fill, hover, and select — no pixel coordinates needed.

The snapshot optimizer pipeline strips chrome (headers/footers), deduplicates links, compresses long names, and truncates lists — reducing token count by 60-90%.

## License

MIT
