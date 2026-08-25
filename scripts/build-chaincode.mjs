#!/usr/bin/env node
/**
 * Build the deployable kyc-registry chaincode package.
 *
 *   npm run chaincode:build
 *
 * WHY THIS EXISTS. `peer lifecycle chaincode package --lang node` tars the
 * directory it is given and asks no questions. The peer's builder then runs
 * `npm install` and `npm start` inside that tar, in hyperledger/fabric-nodeenv.
 * Handing it chaincode/kyc-registry directly could never have worked:
 *
 *   - src/ is TypeScript, and fabric-nodeenv:2.5 runs Node 18 — no
 *     --experimental-strip-types;
 *   - src/ imports @abhi/canonical, @abhi/merkle and @abhi/types, which are
 *     unpublished workspace packages and cannot resolve inside the builder;
 *   - the package declared no dependencies and no start script.
 *
 * So this produces a self-contained artefact in dist/: one CommonJS file with
 * the workspace packages bundled in, and a package.json whose only external
 * dependencies are the Fabric ones the builder can actually fetch from npm.
 *
 * WHY TWO TOOLS. tsc compiles, esbuild bundles, and the order is not a
 * preference. fabric-contract-api's @Transaction decorator reads
 * design:paramtypes off Reflect to build each transaction's parameter list,
 * and fabric-shim validates incoming argument counts against that list.
 * emitDecoratorMetadata is what puts it there, esbuild cannot emit it, and
 * without it every transaction appears to take no arguments and every
 * invocation is rejected. tsc therefore emits JavaScript WITH the metadata
 * first; esbuild only ever sees JavaScript, where the decorators have already
 * been lowered and the metadata is a plain __metadata() call.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CC = join(ROOT, 'chaincode', 'kyc-registry');
const TSC_OUT = join(CC, '.build', 'tsc');
const DIST = join(CC, 'dist');

/** Node 18 is what fabric-nodeenv:2.5 runs. Nothing here may assume newer. */
const RUNTIME_TARGET = 'node18';

const step = (n, msg) => console.log(`==> ${n} ${msg}`);

// --------------------------------------------------------------- 1. compile
step('1/4', 'compiling TypeScript (with decorator metadata)');
rmSync(join(CC, '.build'), { recursive: true, force: true });
rmSync(DIST, { recursive: true, force: true });

// Invoke the compiler's own entry point with this Node rather than the .bin
// shim: on Windows the shim is a .cmd, and spawning one without a shell is an
// EINVAL. This form needs no shell and behaves identically everywhere.
const tsc = join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
execFileSync(process.execPath, [tsc, '-p', join(CC, 'tsconfig.build.json')], {
  stdio: 'inherit',
  cwd: CC,
});

const entry = join(TSC_OUT, 'chaincode', 'kyc-registry', 'src', 'contract.js');
if (!existsSync(entry)) throw new Error(`tsc produced no entry point at ${entry}`);

// ---------------------------------------------------------------- 2. bundle
step('2/4', 'bundling workspace packages into one CommonJS file');

// The workspace packages point their "main" at src/index.ts, so resolving
// @abhi/* through node_modules would land back on TypeScript. Point esbuild at
// the JavaScript tsc just emitted instead.
const alias = {
  '@abhi/canonical': join(TSC_OUT, 'packages', 'canonical', 'src', 'index.js'),
  '@abhi/merkle': join(TSC_OUT, 'packages', 'merkle', 'src', 'index.js'),
  '@abhi/types': join(TSC_OUT, 'packages', 'types', 'src', 'index.js'),
};

mkdirSync(DIST, { recursive: true });
await build({
  entryPoints: [entry],
  outfile: join(DIST, 'index.js'),
  bundle: true,
  platform: 'node',
  target: RUNTIME_TARGET,
  format: 'cjs',
  alias,
  // Left for the builder's npm install. Bundling fabric-shim would detach the
  // contract from the shim actually running it, and reflect-metadata patches a
  // global — two copies would mean decorators writing metadata that the shim
  // then cannot read.
  external: ['fabric-contract-api', 'fabric-shim', 'reflect-metadata'],
  // reflect-metadata must be live before any decorator runs. fabric-contract-api
  // requires it too, but relying on another package's import order to make our
  // own metadata land is the kind of assumption that breaks on a minor upgrade.
  banner: { js: "require('reflect-metadata');" },
  // TypeScript emits a decorated class as `let X = class X {...}; X = __decorate(...)`,
  // and the shadowed binding makes esbuild rename the inner class to X2 — so
  // Class.name comes out as KycRegistryContract2. Harmless while the
  // constructor passes its name to super() explicitly, and a silent trap the
  // moment anyone stops doing that, because fabric-contract-api falls back to
  // the class name to namespace every transaction.
  keepNames: true,
  logLevel: 'warning',
});

// ---------------------------------------------------------- 3. package.json
step('3/4', 'writing the package manifest');
const source = JSON.parse(readFileSync(join(CC, 'package.json'), 'utf8'));

writeFileSync(
  join(DIST, 'package.json'),
  JSON.stringify(
    {
      name: 'kyc-registry',
      version: source.version,
      description: source.description,
      // Not "type": "module" — the bundle is CommonJS because fabric-shim
      // loads the contract with require().
      main: 'index.js',
      engines: { node: '>=18' },
      // The peer launches node chaincode with `npm start`. This binary comes
      // from fabric-shim and is what reads `contracts` out of main.
      scripts: { start: 'fabric-chaincode-node start' },
      // Read from the source package's devDependencies. They are dev there on
      // purpose: the gateway imports @abhi/kyc-registry for its domain logic and
      // never loads contract.ts, so making the Fabric packages runtime deps of
      // the workspace would install fabric-shim's whole gRPC stack into the
      // gateway image — twenty packages of CVE surface in the crown-jewel
      // service, for code it does not run. They ARE runtime dependencies of
      // this bundle, which is why they are declared as such here.
      dependencies: {
        ...source.devDependencies,
        'reflect-metadata': '^0.2.2',
      },
      fabric: source.fabric,
    },
    null,
    2,
  ) + '\n',
);

// ----------------------------------------------------------------- 4. check
step('4/4', 'verifying the artefact');
const bundle = readFileSync(join(DIST, 'index.js'), 'utf8');

const problems = [];
if (!/design:paramtypes/.test(bundle)) {
  problems.push(
    'no design:paramtypes in the bundle — decorator metadata was lost, so every ' +
      'transaction would look like it takes no arguments and every invoke would fail',
  );
}
if (!/exports\.contracts|contracts\s*=/.test(bundle)) {
  problems.push('the bundle does not export `contracts`, which is what fabric-shim looks for');
}
for (const bare of ['@abhi/canonical', '@abhi/merkle', '@abhi/types']) {
  if (new RegExp(`require\\("${bare}"\\)`).test(bundle)) {
    problems.push(`${bare} survived as a bare require — it will not resolve inside the builder`);
  }
}
if (problems.length > 0) {
  for (const p of problems) console.error(`::error::chaincode bundle: ${p}`);
  process.exit(1);
}

// Loading it proves the decorators actually ran: fabric-contract-api applies
// them at class-definition time, so a metadata or import-order fault throws
// here rather than inside a peer three steps later.
const loaded = createRequire(import.meta.url)(join(DIST, 'index.js'));
const classes = loaded.contracts ?? [];
if (classes.length === 0) throw new Error('contracts array is empty after loading the bundle');

// Assert the FABRIC contract name, not the class name. This is the string
// transactions are namespaced under, and getting it wrong makes every invoke
// fail with an unhelpful "contract not found".
const names = classes.map((C) => new C().getName());
if (!names.includes('KycRegistryContract')) {
  throw new Error(`expected a contract named KycRegistryContract, got: ${names.join(', ')}`);
}

// The assertion this whole two-tool pipeline exists for. fabric-shim validates
// the argument count of every incoming invoke against these parameter lists.
// If the decorator metadata were lost they would all be empty, the contract
// would load perfectly, and every single transaction would be rejected at
// runtime with an argument-count error. Checking the shape of the metadata is
// the only way to catch that before a peer does.
const Reflect_ = createRequire(import.meta.url)('reflect-metadata') && globalThis.Reflect;
for (const C of classes) {
  const txs = Reflect_.getMetadata('fabric:transactions', C.prototype) ?? [];
  if (txs.length === 0) {
    throw new Error(`${C.name} registered no transactions`);
  }
  const bare = txs.filter((t) => (t.parameters ?? []).length === 0).map((t) => t.name);
  if (bare.length > 0) {
    throw new Error(
      `these transactions registered no parameters, which means decorator metadata ` +
        `was lost and every invoke of them would be rejected: ${bare.join(', ')}`,
    );
  }
  console.log(`    ${C.name}: ${txs.length} transactions, all with typed parameters`);
}

const kb = (bundle.length / 1024).toFixed(0);
console.log(`\nchaincode/kyc-registry/dist — ${kb} kB, contracts: ${names.join(', ')}`);
