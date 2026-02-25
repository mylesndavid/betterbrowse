export { Browser, findChrome } from './browser.js';
export { browseWeb } from './agent.js';
export { computeDiff, formatActionHistory } from './snapshot-differ.js';
export {
  optimizeAll,
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
  analyzeWaste,
  countRefsInSnapshot,
} from './snapshot-optimizer.js';
