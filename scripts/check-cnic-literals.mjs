#!/usr/bin/env node
/**
 * Reject real CNICs pasted into source.
 *
 *   node scripts/check-cnic-literals.mjs
 *
 * A 13-digit run in source is almost always a real customer CNIC typed in by
 * hand. But fictional CNICs are legitimately needed — to test the PII
 * tripwire, to seed a demo, to prefill a console form.
 *
 * Rather than maintain a path allow-list (which goes stale silently, and which
 * an earlier version of this gate got wrong by not scanning scripts/ or apps/
 * at all), any file that legitimately contains one must declare it:
 *
 *     // FICTIONAL-CNIC-OK: <why>
 *
 * That forces the author to think, documents the intent at the site, and
 * cannot rot the way a path list does.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['packages', 'services', 'chaincode', 'scripts', 'apps', 'tests'];
const EXTS = ['.ts', '.js', '.mjs', '.json', '.html'];
const MARKER = 'FICTIONAL-CNIC-OK';
const CNIC_RUN = /(?<![0-9a-fA-F])[0-9]{13}(?![0-9a-fA-F])/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const offenders = [];
const declared = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    const hits = src
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((l) => CNIC_RUN.test(l.text));
    if (hits.length === 0) continue;

    const rel = relative(ROOT, file).split(sep).join('/');
    if (src.includes(MARKER)) declared.push({ rel, count: hits.length });
    else offenders.push({ rel, hits });
  }
}

for (const d of declared) {
  console.log(`  declared  ${d.rel}  (${d.count} occurrence${d.count === 1 ? '' : 's'})`);
}

if (offenders.length > 0) {
  console.error('\nCNIC-shaped literals in files that have NOT declared them:\n');
  for (const o of offenders) {
    for (const h of o.hits.slice(0, 5)) {
      console.error(`  ${o.rel}:${h.line}  ${h.text.trim().slice(0, 90)}`);
    }
    if (o.hits.length > 5) console.error(`  ${o.rel}  … and ${o.hits.length - 5} more`);
  }
  console.error(
    `\nIf these are fictional, add a "// ${MARKER}: <why>" comment to each file.\n` +
      'If any is a real customer CNIC, remove it and rotate anything derived from it.\n',
  );
  process.exit(1);
}

console.log(`\nOK — ${declared.length} file(s) declare fictional CNICs; no undeclared literals.`);
