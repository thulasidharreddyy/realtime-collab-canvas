import { WebSocket } from 'ws';

async function testBatchingAndThrottling() {
  console.log('Testing Batching and Throttling...');

  const ws1 = new WebSocket('ws://localhost:3000');
  const ws2 = new WebSocket('ws://localhost:3000');

  await new Promise<void>((resolve) => {
    let w1Init = false;
    let w2Init = false;

    ws1.on('open', () => ws1.send(JSON.stringify({ type: 'join', roomId: 'batch-test', name: 'Drawer' })));
    ws2.on('open', () => ws2.send(JSON.stringify({ type: 'join', roomId: 'batch-test', name: 'Observer' })));

    ws1.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'init_state') {
        w1Init = true;
        if (w2Init) resolve();
      }
    });

    ws2.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'init_state') {
        w2Init = true;
        if (w1Init) resolve();
      }
    });
  });

  const strokeId = 'stroke-batched-1';
  let chunkCount = 0;
  let totalPointsReceived = 0;

  ws2.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'remote_stroke_chunk') {
      chunkCount++;
      totalPointsReceived += m.points.length;
      console.log(`Observer received chunk #${chunkCount} containing ${m.points.length} points.`);
    }
  });

  // Drawer starts stroke
  ws1.send(JSON.stringify({
    type: 'stroke_start',
    stroke: {
      id: strokeId,
      userId: 'test-drawer',
      tool: 'brush',
      color: '#2563eb',
      width: 4,
      points: [{ x: 10, y: 10 }],
      status: 'active',
      timestamp: Date.now(),
    }
  }));

  // Drawer sends a batch of 8 points in one chunk
  const batchPoints = [
    { x: 12.3, y: 13.5 },
    { x: 14.1, y: 16.2 },
    { x: 17.0, y: 19.8 },
    { x: 21.2, y: 24.1 },
    { x: 25.5, y: 28.9 },
    { x: 30.1, y: 34.0 },
    { x: 35.8, y: 39.2 },
    { x: 42.0, y: 45.1 },
  ];

  ws1.send(JSON.stringify({
    type: 'stroke_chunk',
    strokeId,
    points: batchPoints,
  }));

  await new Promise((r) => setTimeout(r, 200));

  if (chunkCount === 1 && totalPointsReceived === 8) {
    console.log('Batching verified: 8 points received cleanly in 1 chunk!');
  } else {
    console.error(`Batching verification failed. Chunks: ${chunkCount}, Points: ${totalPointsReceived}`);
    process.exit(1);
  }

  ws1.close();
  ws2.close();
  console.log('Milestone 4 Batching tests PASSED!');
  process.exit(0);
}

testBatchingAndThrottling().catch((err) => {
  console.error('Batching test failed:', err);
  process.exit(1);
});
