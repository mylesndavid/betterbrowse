/**
 * Snapshot Optimizer — post-processing for ARIA snapshots WITH ref preservation
 *
 * Designed to work on ref-annotated snapshots ([ref=eXX] tags).
 * Each optimizer preserves refs on interactive elements throughout the pipeline.
 */

// ── Role sets ────────────────────────────────────────────────────────────

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'searchbox',
  'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);

const CONTENT_ROLES = new Set([
  'heading', 'cell', 'gridcell', 'columnheader', 'rowheader',
  'listitem', 'article', 'region', 'main', 'navigation',
]);

const STRUCTURAL_ROLES = new Set([
  'generic', 'group', 'list', 'table', 'row', 'rowgroup', 'grid',
  'treegrid', 'menu', 'menubar', 'toolbar', 'tablist', 'tree',
  'directory', 'document', 'application', 'presentation', 'none',
]);

// ── Helpers ──────────────────────────────────────────────────────────────

const REF_PATTERN = /\[ref=(e\d+)\]/;
const REF_PATTERN_GLOBAL = /\[ref=(e\d+)\]/g;

function indentLevel(line) {
  const m = line.match(/^(\s*)/);
  return m ? Math.floor(m[1].length / 2) : 0;
}

function parseLine(line) {
  const m = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
  if (!m) return null;
  const suffix = m[4] ?? '';
  const refMatch = suffix.match(REF_PATTERN);
  return {
    prefix: m[1],
    role: m[2].toLowerCase(),
    name: m[3] ?? null,
    suffix,
    ref: refMatch ? refMatch[1] : null,
    raw: line,
  };
}

function getSubtreeEnd(lines, startIdx) {
  const startIndent = indentLevel(lines[startIdx]);
  let end = startIdx + 1;
  while (end < lines.length && indentLevel(lines[end]) > startIndent) end++;
  return end;
}

/** Extract all refs from a set of lines */
function collectRefs(lines) {
  const refs = [];
  for (const line of lines) {
    const matches = line.matchAll(REF_PATTERN_GLOBAL);
    for (const m of matches) refs.push(m[1]);
  }
  return refs;
}

/** Rebuild a line with role, name, and preserved ref+suffix */
function buildLine(prefix, role, name, suffix) {
  let line = `${prefix}${role}`;
  if (name !== null && name !== undefined) line += ` "${name}"`;
  if (suffix) line += suffix;
  return line;
}

// ── 1. Baseline (add refs to raw snapshot) ───────────────────────────────

export function openclawBaseline(snapshot) {
  const lines = snapshot.split('\n');
  const out = [];
  let counter = 0;

  for (const line of lines) {
    const p = parseLine(line);
    if (!p) { out.push(line); continue; }
    if (STRUCTURAL_ROLES.has(p.role) && !p.name) continue;
    if (INTERACTIVE_ROLES.has(p.role) || (CONTENT_ROLES.has(p.role) && p.name)) {
      counter++;
      const ref = `e${counter}`;
      out.push(buildLine(p.prefix, p.role, p.name, ` [ref=${ref}]${p.suffix}`));
      continue;
    }
    out.push(line);
  }
  return compactTree(out.join('\n'));
}

function compactTree(tree) {
  const lines = tree.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (REF_PATTERN.test(line)) { result.push(line); continue; }
    if (line.includes(':') && !line.trimEnd().endsWith(':')) { result.push(line); continue; }
    const currentIndent = indentLevel(line);
    let hasRefChildren = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (indentLevel(lines[j]) <= currentIndent) break;
      if (REF_PATTERN.test(lines[j])) { hasRefChildren = true; break; }
    }
    if (hasRefChildren) result.push(line);
  }
  return result.join('\n');
}

// ── 2a. Chrome stripping (preserves interactive refs from chrome) ────────

export function stripChrome(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];
  let skipUntilIndent = -1;
  let chromeRefs = []; // refs rescued from stripped chrome subtrees

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentLevel(line);

    if (skipUntilIndent >= 0) {
      if (indent > skipUntilIndent) {
        // Collect any refs from this chrome subtree line
        const p = parseLine(line);
        if (p && p.ref && INTERACTIVE_ROLES.has(p.role)) {
          chromeRefs.push({ ref: p.ref, role: p.role, name: p.name });
        }
        continue;
      }
      skipUntilIndent = -1;
    }

    const p = parseLine(line);
    if (p && isChromeLine(p, lines, i)) {
      // Before skipping, collect refs from the chrome root itself
      if (p.ref && INTERACTIVE_ROLES.has(p.role)) {
        chromeRefs.push({ ref: p.ref, role: p.role, name: p.name });
      }
      skipUntilIndent = indent;
      continue;
    }
    result.push(line);
  }

  // If we rescued any interactive refs from chrome, append a minimal summary
  // so the agent can still click sign-in, search, etc.
  if (chromeRefs.length > 0) {
    result.push('- group "chrome-actions"');
    for (const r of chromeRefs) {
      const name = r.name ? ` "${r.name}"` : '';
      result.push(`  - ${r.role}${name} [ref=${r.ref}]`);
    }
  }

  return result.join('\n');
}

function isChromeLine(parsed, lines, idx) {
  if (parsed.role === 'banner' || parsed.role === 'contentinfo') return true;
  if (parsed.role === 'navigation' && indentLevel(lines[idx]) <= 1) return true;
  if (parsed.name && /skip to|cookie|privacy|terms of service/i.test(parsed.name)) {
    if (indentLevel(lines[idx]) <= 1) return true;
  }
  if (parsed.name && /^Advertisement|^Promoted|^Sponsored/i.test(parsed.name)) return true;
  return false;
}

// ── 2a2. Dedup repeated link names within articles ──────────────────────

export function dedupLinks(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];
  const scopeStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentLevel(line);
    const p = parseLine(line);

    while (scopeStack.length > 0 && indent <= scopeStack[scopeStack.length - 1].indent) {
      scopeStack.pop();
    }

    if (p && p.role === 'article') {
      scopeStack.push({ indent, seenNames: new Set() });
      result.push(line);
      continue;
    }

    // Dedup links — but if the first instance has a ref, it's preserved.
    // If a duplicate has a DIFFERENT ref, we lose it (acceptable — same visual element).
    if (p && p.role === 'link' && p.name && scopeStack.length > 0) {
      const scope = scopeStack[scopeStack.length - 1];
      if (scope.seenNames.has(p.name)) {
        const end = getSubtreeEnd(lines, i);
        i = end - 1;
        continue;
      }
      scope.seenNames.add(p.name);
    }

    if (p && p.role === 'img' && !p.name) continue;

    result.push(line);
  }
  return result.join('\n');
}

// ── 2b. Attribute pruning (protects [ref=...] from removal) ─────────────

export function pruneAttributes(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];

  for (const line of lines) {
    if (/^\s*- \/url:/.test(line)) continue;

    let cleaned = line;

    // Temporarily extract refs so no regex can touch them
    const refs = [];
    cleaned = cleaned.replace(REF_PATTERN_GLOBAL, (match) => {
      refs.push(match);
      return `__REF_${refs.length - 1}__`;
    });

    // Remove tracking params from URLs embedded in names
    cleaned = cleaned.replace(/ "(https?:\/\/[^"]+)"/g, (match, url) => {
      try {
        const u = new URL(url);
        return ` "${u.hostname}${u.pathname}"`;
      } catch { return match; }
    });
    cleaned = cleaned.replace(/\s*\[url=[^\]]*\]/g, '');
    cleaned = cleaned.replace(/\s*\[description=""\]/g, '');
    cleaned = cleaned.replace(/\s*\[focused\]/g, '');
    cleaned = cleaned.replace(/\s*\[disabled=false\]/g, '');
    cleaned = cleaned.replace(/\s*\[level=\d+\]/g, '');

    // Restore refs
    cleaned = cleaned.replace(/__REF_(\d+)__/g, (_, idx) => refs[Number(idx)]);

    result.push(cleaned);
  }
  return result.join('\n');
}

// ── 2c. Semantic compression (preserves suffix including refs) ──────────

export function semanticCompress(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];

  for (const line of lines) {
    const p = parseLine(line);
    if (!p || !p.name) { result.push(line); continue; }

    const compressed = compressFlightName(p.name);
    if (compressed !== p.name) {
      result.push(buildLine(p.prefix, p.role, compressed, p.suffix));
      continue;
    }

    let name = p.name;
    name = name.replace(/From (\d+) US dollars?/gi, '$$$1');
    name = name.replace(/(\d+) US dollars?/gi, '$$$1');
    name = name.replace(/\s{2,}/g, ' ').trim();
    name = name.replace(/\bNonstop\b/gi, 'nonstop');
    name = name.replace(/\bRound trip\b/gi, 'RT');
    name = name.replace(/\bone stop\b/gi, '1-stop');
    name = name.replace(/\btwo stops?\b/gi, '2-stop');

    if (name !== p.name) {
      result.push(buildLine(p.prefix, p.role, name, p.suffix));
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

function compressFlightName(name) {
  const priceMatch = name.match(/(?:From\s+)?(\d+)\s*US\s*dollars?/i);
  const airlineMatch = name.match(/(?:dollars?\.?\s*(?:round\s*trip\.?\s*)?)([\w\s]+?)\.?\s*(?:Leaves|Departs)/i);
  const depMatch = name.match(/(?:Leaves|Departs)\s+(.+?)\s+at\s+(\d+:\d+\s*[AP]M)/i);
  const arrMatch = name.match(/(?:Arrives?)\s+(.+?)\s+at\s+(\d+:\d+\s*[AP]M)/i);
  const durMatch = name.match(/(?:Total\s+)?duration\s+(\d+)\s*hr?\s*(\d+)?\s*min/i);
  const stopsMatch = name.match(/(Nonstop|\d+\s*stops?)/i);

  if (priceMatch && depMatch && arrMatch) {
    const price = `$${priceMatch[1]}`;
    const airline = airlineMatch ? airlineMatch[1].trim() : '';
    const depCode = airportCode(depMatch[1]);
    const depTime = depMatch[2].replace(/\s/g, '');
    const arrCode = airportCode(arrMatch[1]);
    const arrTime = arrMatch[2].replace(/\s/g, '');
    const dur = durMatch ? `${durMatch[1]}h${durMatch[2] ? durMatch[2] : ''}` : '';
    const stops = stopsMatch ? stopsMatch[1].toLowerCase().replace('nonstop', 'nonstop') : '';
    return `${airline} ${depCode} ${depTime}→${arrCode} ${arrTime} ${dur} ${stops} ${price}`.replace(/\s+/g, ' ').trim();
  }
  return name;
}

const AIRPORT_MAP = {
  'san francisco international': 'SFO', 'san francisco': 'SFO',
  'john f. kennedy international': 'JFK', 'john f kennedy international': 'JFK',
  'jfk': 'JFK', 'kennedy': 'JFK',
  'los angeles international': 'LAX', 'los angeles': 'LAX',
  'newark liberty international': 'EWR', 'newark': 'EWR',
  "o'hare international": 'ORD', 'ohare': 'ORD',
  'laguardia': 'LGA',
  'seattle-tacoma international': 'SEA', 'seattle': 'SEA',
  'logan international': 'BOS', 'boston': 'BOS',
  'hartsfield-jackson atlanta international': 'ATL',
  'dallas/fort worth international': 'DFW',
  'denver international': 'DEN',
  'miami international': 'MIA',
};

function airportCode(fullName) {
  const lower = fullName.toLowerCase().replace(/airport/gi, '').trim();
  for (const [key, code] of Object.entries(AIRPORT_MAP)) {
    if (lower.includes(key)) return code;
  }
  return fullName.slice(0, 3).toUpperCase();
}

// ── 2d. Smart truncation (preserves ref count info) ─────────────────────

export function smartTruncate(snapshot, { maxItems = 5 } = {}) {
  const lines = snapshot.split('\n');
  const result = [];
  const listTracker = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p = parseLine(line);
    if (!p) { result.push(line); continue; }

    if (p.role === 'listitem' || p.role === 'row' || p.role === 'article') {
      const indent = indentLevel(line);
      const key = `${indent}:${p.role}`;
      if (!listTracker.has(key)) {
        listTracker.set(key, { count: 0, droppedRefs: 0 });
      }
      const tracker = listTracker.get(key);
      tracker.count++;

      if (tracker.count <= maxItems) {
        result.push(line);
      } else if (tracker.count === maxItems + 1) {
        const subtreeEnd = getSubtreeEnd(lines, i);
        const remaining = countSiblings(lines, i, p.role);
        // Count refs being dropped in this and subsequent items
        const skippedEnd = findSiblingGroupEnd(lines, i, p.role);
        const droppedRefs = collectRefs(lines.slice(i, skippedEnd));
        const refNote = droppedRefs.length > 0 ? ` (${droppedRefs.length} refs hidden: ${droppedRefs.slice(0, 3).join(',')}...)` : '';
        result.push(`${' '.repeat(indent * 2)}- text "... and ${remaining} more ${p.role}s${refNote}"`);
        i = subtreeEnd - 1;
      } else {
        const subtreeEnd = getSubtreeEnd(lines, i);
        i = subtreeEnd - 1;
      }
      continue;
    }

    result.push(line);
  }
  return result.join('\n');
}

function countSiblings(lines, startIdx, role) {
  const indent = indentLevel(lines[startIdx]);
  let count = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const lvl = indentLevel(lines[i]);
    if (lvl < indent) break;
    if (lvl === indent) {
      const p = parseLine(lines[i]);
      if (p && p.role === role) count++;
    }
  }
  return count;
}

function findSiblingGroupEnd(lines, startIdx, role) {
  const indent = indentLevel(lines[startIdx]);
  let last = startIdx;
  for (let i = startIdx; i < lines.length; i++) {
    const lvl = indentLevel(lines[i]);
    if (lvl < indent) break;
    last = i;
  }
  return last + 1;
}

// ── 2e. Viewport-only filter ────────────────────────────────────────────

export function viewportOnly(snapshot, visibleRefs) {
  if (!visibleRefs || visibleRefs.size === 0) return snapshot;
  const lines = snapshot.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const refMatch = line.match(REF_PATTERN);
    if (refMatch) {
      if (visibleRefs.has(refMatch[1])) result.push(line);
      continue;
    }
    const indent = indentLevel(line);
    let hasVisibleChild = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (indentLevel(lines[j]) <= indent) break;
      const childRef = lines[j].match(REF_PATTERN);
      if (childRef && visibleRefs.has(childRef[1])) {
        hasVisibleChild = true;
        break;
      }
    }
    if (hasVisibleChild) result.push(line);
  }
  return result.join('\n');
}

// ── Interactive-only filter ─────────────────────────────────────────────

export function interactiveOnly(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p = parseLine(line);

    // Always keep lines with refs
    if (REF_PATTERN.test(line)) {
      result.push(line);
      continue;
    }

    // Keep structural parents that have ref children
    if (p) {
      const indent = indentLevel(line);
      let hasRefChild = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (indentLevel(lines[j]) <= indent) break;
        if (REF_PATTERN.test(lines[j])) { hasRefChild = true; break; }
      }
      if (hasRefChild) result.push(line);
    }
  }
  return result.join('\n');
}

// ── 2f. Collapse redundant children ─────────────────────────────────────

export function collapseRedundantChildren(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p = parseLine(line);
    result.push(line);

    // Check if this is a named link/button with children
    if (p && p.name && p.name.length > 40 && (p.role === 'link' || p.role === 'button')) {
      const parentIndent = indentLevel(line);
      const subtreeEnd = getSubtreeEnd(lines, i);
      const parentNameLower = p.name.toLowerCase();

      // Check if ALL children's text is contained in the parent name
      let allRedundant = true;
      let hasRefChild = false;
      for (let j = i + 1; j < subtreeEnd; j++) {
        const child = parseLine(lines[j]);
        if (!child) { allRedundant = false; break; }
        // Children with their own refs that are interactive must be kept
        if (child.ref && INTERACTIVE_ROLES.has(child.role)) {
          allRedundant = false; break;
        }
        if (child.ref) hasRefChild = true;
        if (child.name) {
          // Check if child name is substantially contained in parent
          const childWords = child.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const contained = childWords.filter(w => parentNameLower.includes(w));
          if (contained.length < childWords.length * 0.6) {
            allRedundant = false; break;
          }
        }
      }

      if (allRedundant && subtreeEnd > i + 1) {
        // Skip all children — parent name already has the info
        i = subtreeEnd - 1;
      }
    }
  }
  return result.join('\n');
}

// ── 2g. Truncate very long names ────────────────────────────────────────

export function truncateLongNames(snapshot, { maxNameLength = 120 } = {}) {
  const lines = snapshot.split('\n');
  const result = [];

  for (const line of lines) {
    const p = parseLine(line);
    if (p && p.name && p.name.length > maxNameLength) {
      const truncated = p.name.slice(0, maxNameLength).replace(/\s\S*$/, '') + '...';
      result.push(buildLine(p.prefix, p.role, truncated, p.suffix));
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

// ── 2h. Remove noise lines ──────────────────────────────────────────────

export function removeNoise(snapshot) {
  const lines = snapshot.split('\n');
  const result = [];

  for (const line of lines) {
    // Remove /placeholder lines (info is in the textbox name)
    if (/^\s*- \/placeholder:/.test(line)) continue;
    // Remove empty text nodes
    if (/^\s*- text:\s*$/.test(line)) continue;
    // Remove text nodes with only whitespace
    if (/^\s*- text: "\s*"$/.test(line)) continue;
    // Keep everything else
    result.push(line);
  }
  return result.join('\n');
}

// ── Composition ─────────────────────────────────────────────────────────

export function optimizeAll(snapshot, options = {}) {
  let result = snapshot;
  result = stripChrome(result);
  result = pruneAttributes(result);
  result = removeNoise(result);
  result = dedupLinks(result);
  result = collapseRedundantChildren(result);
  result = semanticCompress(result);
  result = truncateLongNames(result, { maxNameLength: options.maxNameLength ?? 120 });
  result = smartTruncate(result, { maxItems: options.maxItems ?? 5 });
  if (options.visibleRefs) {
    result = viewportOnly(result, options.visibleRefs);
  }
  if (options.interactiveOnly) {
    result = interactiveOnly(result);
  }
  // Clean up blank lines
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

// ── Analysis ────────────────────────────────────────────────────────────

export function analyzeWaste(snapshot) {
  const lines = snapshot.split('\n');
  const buckets = {
    chrome: { lines: 0, chars: 0 },
    structural: { lines: 0, chars: 0 },
    interactive: { lines: 0, chars: 0 },
    content: { lines: 0, chars: 0 },
    other: { lines: 0, chars: 0 },
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const chars = line.length + 1;
    const p = parseLine(line);

    if (!p) { buckets.other.lines++; buckets.other.chars += chars; continue; }

    if (isChromeLine(p, lines, i)) {
      const end = getSubtreeEnd(lines, i);
      for (let j = i; j < end; j++) {
        buckets.chrome.lines++;
        buckets.chrome.chars += lines[j].length + 1;
      }
      i = end - 1;
      continue;
    }

    if (STRUCTURAL_ROLES.has(p.role) && !p.name) {
      buckets.structural.lines++; buckets.structural.chars += chars;
    } else if (INTERACTIVE_ROLES.has(p.role)) {
      buckets.interactive.lines++; buckets.interactive.chars += chars;
    } else if (CONTENT_ROLES.has(p.role)) {
      buckets.content.lines++; buckets.content.chars += chars;
    } else {
      buckets.other.lines++; buckets.other.chars += chars;
    }
  }

  const total = lines.join('\n').length;
  const report = {};
  for (const [key, val] of Object.entries(buckets)) {
    report[key] = { ...val, pct: total > 0 ? ((val.chars / total) * 100).toFixed(1) + '%' : '0%' };
  }
  report.total = { lines: lines.length, chars: total };
  return report;
}

// ── Stats helper ────────────────────────────────────────────────────────

export function countRefsInSnapshot(snapshot) {
  const matches = snapshot.match(REF_PATTERN_GLOBAL);
  return matches ? matches.length : 0;
}

export default {
  openclawBaseline,
  stripChrome,
  pruneAttributes,
  dedupLinks,
  collapseRedundantChildren,
  truncateLongNames,
  removeNoise,
  semanticCompress,
  smartTruncate,
  viewportOnly,
  interactiveOnly,
  optimizeAll,
  analyzeWaste,
  countRefsInSnapshot,
};
