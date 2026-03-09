#!/usr/bin/env node
// CLI for betterbrowse — global install: npm install -g @mylesiyabor/betterbrowse
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

console.log(`
betterbrowse v${pkg.version}
Zero-dependency browser automation via Chrome DevTools Protocol + ARIA snapshots.

Install:    npm install -g @mylesiyabor/betterbrowse   (global)
            npm install @mylesiyabor/betterbrowse     (project)

Use in code:
  import { Browser, browseWeb } from '@mylesiyabor/betterbrowse';

Docs:       https://github.com/mylesndavid/betterbrowse#readme
npm:        https://www.npmjs.com/package/@mylesiyabor/betterbrowse
`);
