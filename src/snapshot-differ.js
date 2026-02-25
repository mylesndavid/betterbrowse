/**
 * Snapshot Differ — computes compact diffs between ARIA snapshots
 *
 * Instead of sending full snapshots to the LLM every step, compute what changed.
 * General-purpose: works on any website, no site-specific logic.
 *
 * Diff format:
 *   + element "name" [ref=eXX]       — new element (appeared)
 *   - element "name" [ref=eXX]       — removed element (gone)
 *   ~ element "name": "old" → "new"  — changed element
 *   = N unchanged elements (not shown)
 */

// ── Element Parsing ─────────────────────────────────────────────────────

const ELEMENT_RE = /^(\s*)-\s*(button|link|textbox|checkbox|radio|combobox|listbox|menuitem|menuitemcheckbox|menuitemradio|option|searchbox|slider|spinbutton|switch|tab|treeitem|heading|cell|gridcell|columnheader|rowheader|listitem|article|region|main|navigation|dialog|document|group|list|table|row|generic|text|strong|emphasis|mark)\s*("(?:[^"\\]|\\.)*")?\s*(?:\[ref=(e\d+)\])?/;

/**
 * Parse a snapshot string into a flat list of elements
 */
function parseElements(snapshot) {
  if (!snapshot) return [];
  const lines = snapshot.split('\n');
  const elements = [];

  for (const line of lines) {
    const m = line.match(ELEMENT_RE);
    if (!m) continue;
    const [, indent, role, nameQuoted, ref] = m;
    const name = nameQuoted ? nameQuoted.slice(1, -1) : '';
    // Also capture the full trimmed line for display
    const display = line.trimStart().replace(/^-\s*/, '');
    elements.push({ role, name, ref: ref || null, display, indent: indent.length });
  }
  return elements;
}

/**
 * Extract page context from snapshot: title, landmarks
 */
function extractContext(snapshot) {
  const ctx = { title: null, landmarks: [] };
  const lines = snapshot.split('\n');
  for (const line of lines) {
    const trimmed = line.trimStart();
    // First heading = title
    if (!ctx.title && /^-\s*heading\s+"([^"]*)"/.test(trimmed)) {
      ctx.title = trimmed.match(/^-\s*heading\s+"([^"]*)"/)[1];
    }
    // Landmarks
    if (/^-\s*(main|navigation|region)\s+"([^"]*)"/.test(trimmed)) {
      const lm = trimmed.match(/^-\s*(main|navigation|region)\s+"([^"]*)"/);
      ctx.landmarks.push(`${lm[1]} "${lm[2]}"`);
    }
  }
  return ctx;
}

/**
 * Compute diff between previous and current snapshots.
 * Returns { diff, stats, isLargeDiff }
 */
export function computeDiff(prevSnapshot, currSnapshot, prevUrl, currUrl) {
  const prev = parseElements(prevSnapshot);
  const curr = parseElements(currSnapshot);

  // Build lookup maps
  // Primary key: ref (exact match)
  // Secondary key: role+name (fuzzy match for elements without refs)
  const prevByRef = new Map();
  const prevByRoleName = new Map();
  const currByRef = new Map();
  const currByRoleName = new Map();

  for (const el of prev) {
    if (el.ref) prevByRef.set(el.ref, el);
    const key = `${el.role}::${el.name}`;
    if (!prevByRoleName.has(key)) prevByRoleName.set(key, el);
  }
  for (const el of curr) {
    if (el.ref) currByRef.set(el.ref, el);
    const key = `${el.role}::${el.name}`;
    if (!currByRoleName.has(key)) currByRoleName.set(key, el);
  }

  const added = [];    // in curr but not prev
  const removed = [];  // in prev but not curr
  const changed = [];  // in both but different
  let unchanged = 0;

  const matchedPrevKeys = new Set(); // track which prev elements got matched

  // Match current elements against previous
  for (const el of curr) {
    let prevEl = null;
    let matchKey = null;

    // Try ref match first
    if (el.ref && prevByRef.has(el.ref)) {
      prevEl = prevByRef.get(el.ref);
      matchKey = `ref:${el.ref}`;
    }
    // Fallback: role+name match
    if (!prevEl) {
      const key = `${el.role}::${el.name}`;
      if (prevByRoleName.has(key)) {
        prevEl = prevByRoleName.get(key);
        matchKey = `rn:${key}`;
      }
    }

    if (prevEl) {
      matchedPrevKeys.add(matchKey);
      // Check if content changed (different name for same ref, or different display)
      if (el.ref && prevEl.ref === el.ref && el.name !== prevEl.name) {
        changed.push({ curr: el, prev: prevEl });
      } else {
        unchanged++;
      }
    } else {
      added.push(el);
    }
  }

  // Find removed elements (in prev, not matched)
  for (const el of prev) {
    let matched = false;
    if (el.ref && matchedPrevKeys.has(`ref:${el.ref}`)) matched = true;
    if (!matched) {
      const key = `${el.role}::${el.name}`;
      if (matchedPrevKeys.has(`rn:${key}`)) matched = true;
    }
    if (!matched) removed.push(el);
  }

  // Build diff string
  const lines = [];

  // URL context
  lines.push(`URL: ${currUrl}`);
  if (prevUrl && currUrl !== prevUrl) {
    lines.push(`CHANGED from ${prevUrl}`);
  }

  // Page context
  const ctx = extractContext(currSnapshot);
  if (ctx.title) lines.push(`Title: ${ctx.title}`);

  lines.push('');

  // Filter: skip structural noise (generic, group, list, table, row, document, text)
  const NOISE_ROLES = new Set(['generic', 'group', 'list', 'table', 'row', 'document', 'text', 'strong', 'emphasis', 'mark']);

  const filterNoise = (el) => !NOISE_ROLES.has(el.role);

  const filteredAdded = added.filter(filterNoise);
  const filteredRemoved = removed.filter(filterNoise);

  // Additions
  for (const el of filteredAdded) {
    const refStr = el.ref ? ` [ref=${el.ref}]` : '';
    const nameStr = el.name ? ` "${el.name}"` : '';
    lines.push(`+ ${el.role}${nameStr}${refStr}`);
  }

  // Removals
  for (const el of filteredRemoved) {
    const refStr = el.ref ? ` [ref=${el.ref}]` : '';
    const nameStr = el.name ? ` "${el.name}"` : '';
    lines.push(`- ${el.role}${nameStr}${refStr}`);
  }

  // Changes
  for (const { curr: el, prev: prevEl } of changed) {
    const refStr = el.ref ? ` [ref=${el.ref}]` : '';
    lines.push(`~ ${el.role}${refStr}: "${prevEl.name}" → "${el.name}"`);
  }

  // Summary
  if (unchanged > 0) {
    lines.push(`= ${unchanged} unchanged elements (not shown)`);
  }

  const diffText = lines.join('\n');
  const totalElements = curr.length;
  const changedElements = filteredAdded.length + filteredRemoved.length + changed.length;
  const diffRatio = totalElements > 0 ? changedElements / totalElements : 1;

  return {
    diff: diffText,
    stats: {
      added: filteredAdded.length,
      removed: filteredRemoved.length,
      changed: changed.length,
      unchanged,
      total: totalElements,
      diffRatio,
    },
    // If >70% changed, page is basically new — send full snapshot instead
    isLargeDiff: diffRatio > 0.7,
    // Empty diff = action had no visible effect
    isEmpty: changedElements === 0,
  };
}

/**
 * Format action history for prompt injection
 */
export function formatActionHistory(history) {
  if (!history || history.length === 0) return '';
  const lines = history.map((h, i) => {
    let desc = `[${i + 1}] ${h.action}`;
    if (h.ref) desc += ` ${h.ref}`;
    if (h.text) desc += ` "${h.text}"`;
    desc += ` → ${h.result}`;
    return desc;
  });
  return `Previous actions:\n${lines.join('\n')}`;
}
