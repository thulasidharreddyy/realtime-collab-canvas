import { execSync, spawn, ChildProcess } from 'child_process';
import http from 'http';

function checkServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function run() {
  console.log('=== Running Collaborative Canvas Test Suite ===\n');

  let spawnedServer: ChildProcess | null = null;
  const alreadyRunning = await checkServer();

  if (!alreadyRunning) {
    console.log('Starting standalone test server on port 3000...');
    spawnedServer = spawn('npx', ['tsx', 'server/server.ts'], { shell: true, stdio: 'ignore' });

    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await checkServer()) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      console.error('Failed to start test server.');
      process.exit(1);
    }
    console.log('Test server ready.\n');
  }

  const tests = [
    'test/server-smoke.ts',
    'test/presence-smoke.ts',
    'test/batching-smoke.ts',
    'test/undo-redo-smoke.ts',
    'test/conflict-resolution.test.ts',
  ];

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

  if (spawnedServer && spawnedServer.pid) {
    // Cleanly terminate spawned server process tree on windows
    try {
      execSync(`taskkill /pid ${spawnedServer.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Ignored if already exited
    }
  }

  if (failed) {
    console.error('Test suite FAILED.');
    process.exit(1);
  } else {
    console.log('=== ALL 5 TEST SUITES PASSED CLEANLY! ===');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
