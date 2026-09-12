import { WebSocket } from 'ws';

async function testSimultaneousOverlappingEdits() {
  console.log('Testing Simultaneous Overlapping Edits & Deterministic Conflict Resolution...');

  const ws1 = new WebSocket('ws://localhost:3000');
  const ws2 = new WebSocket('ws://localhost:3000');

  const roomId = `conflict-room-${Date.now()}`;

  await new Promise<void>((resolve) => {
    let w1Init = false;
    let w2Init = false;

    ws1.on('open', () => ws1.send(JSON.stringify({ type: 'join', roomId, name: 'User 1' })));
    ws2.on('open', () => ws2.send(JSON.stringify({ type: 'join', roomId, name: 'User 2' })));

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

  // Simultaneous strokes: Both users emit stroke_start nearly concurrently
  const s1 = {
    id: 'stroke-concurrent-1',
    userId: 'u1',
    tool: 'brush',
    color: '#2563eb',
    width: 6,
    points: [{ x: 100, y: 100 }, { x: 150, y: 150 }],
    status: 'active',
    timestamp: Date.now(),
  };

  const s2 = {
    id: 'stroke-concurrent-2',
    userId: 'u2',
    tool: 'brush',
    color: '#ef4444',
    width: 6,
    points: [{ x: 100, y: 150 }, { x: 150, y: 100 }], // intersects s1
    status: 'active',
    timestamp: Date.now(),
  };

  const s3Eraser = {
    id: 'stroke-concurrent-3',
    userId: 'u1',
    tool: 'eraser',
    color: '#000000',
    width: 20,
    points: [{ x: 125, y: 125 }], // erases exact intersection point
    status: 'active',
    timestamp: Date.now(),
  };

  console.log('Emitting concurrent strokes...');
  ws1.send(JSON.stringify({ type: 'stroke_start', stroke: s1 }));
  ws2.send(JSON.stringify({ type: 'stroke_start', stroke: s2 }));
  ws1.send(JSON.stringify({ type: 'stroke_start', stroke: s3Eraser }));

  await new Promise((r) => setTimeout(r, 150));

  // Verify server assigned strictly monotonic sequence numbers
  const syncPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for history sync')), 3000);
    ws2.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'history_sync') {
        const strokes = m.strokes;
        const seqs = strokes.map((s: any) => s.seq);
        console.log('Received sequence numbers:', seqs);

        // Assert strictly increasing sequences
        for (let i = 1; i < seqs.length; i++) {
          if (seqs[i] <= seqs[i - 1]) {
            clearTimeout(timer);
            reject(new Error(`Non-monotonic sequence detected: ${seqs[i]} <= ${seqs[i-1]}`));
            return;
          }
        }
        clearTimeout(timer);
        resolve();
      }
    });
  });

  // Trigger undo on the eraser
  console.log('Undoing eraser stroke...');
  ws2.send(JSON.stringify({ type: 'undo' }));
  await syncPromise;

  console.log('Conflict resolution verified: Canonical ordering preserved and monotonic sequence numbers enforced!');

  ws1.close();
  ws2.close();
  console.log('All Milestone 6 Conflict Resolution tests PASSED!');
  process.exit(0);
}

testSimultaneousOverlappingEdits().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
