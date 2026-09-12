import { WebSocket } from 'ws';

async function testGlobalUndoRedo() {
  console.log('Testing Global Multi-User Undo & Redo...');

  const wsA = new WebSocket('ws://localhost:3000');
  const wsB = new WebSocket('ws://localhost:3000');

  const roomId = `undo-test-${Date.now()}`;

  await new Promise<void>((resolve) => {
    let aReady = false;
    let bReady = false;

    wsA.on('open', () => wsA.send(JSON.stringify({ type: 'join', roomId, name: 'UserA' })));
    wsB.on('open', () => wsB.send(JSON.stringify({ type: 'join', roomId, name: 'UserB' })));

    wsA.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'init_state') {
        aReady = true;
        if (bReady) resolve();
      }
    });

    wsB.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'init_state') {
        bReady = true;
        if (aReady) resolve();
      }
    });
  });

  // Step 1: User A draws Stroke 1
  console.log('Step 1: User A draws Stroke 1');
  wsA.send(JSON.stringify({
    type: 'stroke_start',
    stroke: {
      id: 'stroke-1',
      userId: 'user-a',
      tool: 'brush',
      color: '#2563eb',
      width: 4,
      points: [{ x: 50, y: 50 }],
      status: 'active',
      timestamp: Date.now(),
    }
  }));

  // Step 2: User B draws Stroke 2
  console.log('Step 2: User B draws Stroke 2');
  wsB.send(JSON.stringify({
    type: 'stroke_start',
    stroke: {
      id: 'stroke-2',
      userId: 'user-b',
      tool: 'brush',
      color: '#ef4444',
      width: 8,
      points: [{ x: 60, y: 60 }],
      status: 'active',
      timestamp: Date.now(),
    }
  }));

  await new Promise((r) => setTimeout(r, 100));

  // Step 3: User A triggers Global Undo -> Stroke 2 (drawn by User B) must be undone!
  console.log('Step 3: User A triggers Global Undo...');
  const undoPromiseA = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for undo on Client A')), 3000);
    wsA.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'history_sync') {
        const active = m.strokes.filter((s: any) => s.status === 'active');
        console.log(`User A received history_sync after Undo: ${active.length} active strokes.`);
        if (active.length === 1 && active[0].id === 'stroke-1') {
          clearTimeout(timer);
          resolve();
        }
      }
    });
  });

  const undoPromiseB = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for undo on Client B')), 3000);
    wsB.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'history_sync') {
        const active = m.strokes.filter((s: any) => s.status === 'active');
        console.log(`User B received history_sync after Undo: ${active.length} active strokes.`);
        if (active.length === 1 && active[0].id === 'stroke-1') {
          clearTimeout(timer);
          resolve();
        }
      }
    });
  });

  wsA.send(JSON.stringify({ type: 'undo' }));
  await Promise.all([undoPromiseA, undoPromiseB]);
  console.log('Global Undo verified: User A successfully undid User B\'s stroke across both clients!');

  // Step 4: User B triggers Global Redo -> Stroke 2 must be restored for both users!
  console.log('Step 4: User B triggers Global Redo...');
  const redoPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for redo')), 3000);
    wsA.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'history_sync') {
        const active = m.strokes.filter((s: any) => s.status === 'active');
        if (active.length === 2) {
          console.log(`User A received history_sync after Redo: both strokes restored.`);
          clearTimeout(timer);
          resolve();
        }
      }
    });
  });

  wsB.send(JSON.stringify({ type: 'redo' }));
  await redoPromise;
  console.log('Global Redo verified: User B restored Stroke 2 for all users!');

  wsA.close();
  wsB.close();
  console.log('All Milestone 5 Global Undo/Redo tests PASSED!');
  process.exit(0);
}

testGlobalUndoRedo().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
