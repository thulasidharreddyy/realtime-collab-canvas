import { execSync } from 'child_process';

const tests = [
  'test/server-smoke.ts',
  'test/presence-smoke.ts',
  'test/batching-smoke.ts',
  'test/undo-redo-smoke.ts',
  'test/conflict-resolution.test.ts',
];

console.log('=== Running Collaborative Canvas Test Suite ===\n');

let failed = false;
for (const test of tests) {
  try {
    console.log(`--- Running: ${test} ---`);
    execSync(`npx tsx ${test}`, { stdio: 'inherit' });
    console.log(`[PASS] ${test}\n`);
  } catch (err) {
    console.error(`[FAIL] ${test}\n`);
    failed = true;
    break;
  }
}

if (failed) {
  console.error('Test suite FAILED.');
  process.exit(1);
} else {
  console.log('=== ALL 5 TEST SUITES PASSED CLEANLY! ===');
  process.exit(0);
}
