#!/usr/bin/env node
// CLI for betterbrowse — agents can run: betterbrowse <url> "<task>"
// Global install: npm install -g @mylesiyabor/betterbrowse
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Browser } from './src/browser.js';
import { browseWeb } from './src/agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const args = process.argv.slice(2);

// --version / -v
if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

// --help / -h
function showHelp() {
  console.log(`
betterbrowse v${pkg.version} — CLI for browser automation (ARIA snapshots, no vision model).

Usage:
  betterbrowse <url>                    Get ARIA snapshot of the page (stdout)
  betterbrowse <url> "<task>"           Run agent to complete task (uses OpenAI)

Options:
  --model <name>     OpenAI model (default: gpt-4o-mini). Needs OPENAI_API_KEY.
  --headless         Run Chrome headless (default: true)
  --no-headless      Show browser window
  --record           Record the browser session as video (MP4 if ffmpeg installed)
  --record-dir <dir> Directory for recording output (default: cwd or temp)
  -v, --version      Print version
  -h, --help         This help

Examples:
  betterbrowse https://example.com
  betterbrowse https://news.ycombinator.com "What is the top story title?"
  betterbrowse https://example.com "Click the first link" --no-headless --record
  betterbrowse https://example.com "Sign in" --record --record-dir ./recordings

For agent mode (url + task), set OPENAI_API_KEY. Result is printed to stdout.
Video recording: use --record; output path is written to stderr. Requires ffmpeg for MP4.
`);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

// Parse flags
const headless = !args.includes('--no-headless');
const record = args.includes('--record');
const modelIdx = args.indexOf('--model');
const recordDirIdx = args.indexOf('--record-dir');
const model = modelIdx >= 0 && args[modelIdx + 1] ? args[modelIdx + 1] : 'gpt-4o-mini';
const recordDir = recordDirIdx >= 0 && args[recordDirIdx + 1] ? args[recordDirIdx + 1] : undefined;
const positional = args.filter(a => {
  if (a.startsWith('--')) return false;
  if (a === '--no-headless') return false;
  if (modelIdx >= 0 && (a === args[modelIdx] || a === args[modelIdx + 1])) return false;
  if (recordDirIdx >= 0 && (a === args[recordDirIdx] || a === args[recordDirIdx + 1])) return false;
  return true;
});

const url = positional[0];
const task = positional[1];

if (!url) {
  console.error('betterbrowse: missing URL. Use betterbrowse <url> or betterbrowse <url> "<task>"');
  showHelp();
  process.exit(1);
}

// Build absolute URL if needed
let targetUrl = url;
if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

async function openaiChat(messages, { tools, maxTokens }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for agent mode. Set it or use snapshot-only: betterbrowse <url>');
  }

  // Convert to OpenAI API format
  const openaiMessages = messages.map(m => {
    const out = { role: m.role, content: m.content ?? '' };
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function?.name || tc.name, arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.arguments || {}) },
      }));
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    return out;
  });

  const body = {
    model,
    messages: openaiMessages,
    max_tokens: maxTokens || 1024,
    tools: tools?.length ? tools.map(t => ({ type: 'function', function: t.function })) : undefined,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('OpenAI API: no message in response');

  const toolCalls = msg.tool_calls?.map(tc => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: (() => {
      try {
        return JSON.parse(tc.function?.arguments || '{}');
      } catch {
        return {};
      }
    })(),
  }));

  return {
    content: msg.content || '',
    toolCalls: toolCalls || [],
    usage: data.usage ? {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    } : undefined,
  };
}

async function main() {
  try {
    if (!task) {
      // Snapshot-only: open URL, print ARIA snapshot to stdout
      const browser = new Browser({ headless });
      await browser.launch();
      if (record) await browser.startRecording();
      await browser.navigate(targetUrl);
      const snapshot = await browser.getSnapshot();
      const recording = record ? await browser.stopRecording({ outputDir: recordDir }) : null;
      await browser.close();
      if (recording?.video) {
        console.error('betterbrowse: recording saved to', recording.video);
      } else if (recording?.frameDir && recording.frameCount > 0) {
        console.error('betterbrowse: frames saved to', recording.frameDir, '(install ffmpeg for MP4)');
      }
      console.log(snapshot);
      process.exit(0);
    }

    // Full agent: url + task
    const result = await browseWeb(targetUrl, task, {
      chat: openaiChat,
      headless,
      record,
      recordDir,
    });
    if (result.recording?.video) {
      console.error('betterbrowse: recording saved to', result.recording.video);
    } else if (result.recording?.frameDir && result.recording?.frameCount > 0) {
      console.error('betterbrowse: frames saved to', result.recording.frameDir, '(install ffmpeg for MP4)');
    }
    // Result to stdout so agents can capture it
    console.log(result.result);
    process.exit(0);
  } catch (err) {
    console.error('betterbrowse:', err.message);
    process.exit(1);
  }
}

main();
