import { WebSocket } from 'ws';
import http from 'http';

async function runTest() {
  console.log('Testing HTTP static file serving...');
  const req = http.get('http://localhost:3000', (res) => {
    console.log(`HTTP Status: ${res.statusCode}`);
    if (res.statusCode !== 200) {
      console.error('Expected HTTP 200');
      process.exit(1);
    }
  });

  req.on('error', (err) => {
    console.error('HTTP Request failed:', err);
    process.exit(1);
  });

  // Test WebSocket connection and message relay
  console.log('Connecting Client 1 to ws://localhost:3000...');
  const ws1 = new WebSocket('ws://localhost:3000');
  const ws2 = new WebSocket('ws://localhost:3000');

  let ws1Ready = false;
  let ws2Ready = false;

  await new Promise<void>((resolve) => {
    ws1.on('open', () => {
      ws1.send(JSON.stringify({ type: 'join', roomId: 'test-room', name: 'User 1' }));
    });

    ws1.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'init_state') {
        console.log('Client 1 received init_state with userId:', msg.userId);
        ws1Ready = true;
        if (ws2Ready) resolve();
      }
    });

    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'join', roomId: 'test-room', name: 'User 2' }));
    });

    ws2.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'init_state') {
        console.log('Client 2 received init_state with userId:', msg.userId);
        ws2Ready = true;
        if (ws1Ready) resolve();
      }
    });
  });

  // Client 1 sends a stroke_start and stroke_chunk; Client 2 should receive it
  console.log('Client 1 sending stroke_start...');
  const strokeTest = {
    id: 'stroke-100',
    userId: 'test-user-1',
    tool: 'brush',
    color: '#ef4444',
    width: 5,
    points: [{ x: 10, y: 10 }],
    status: 'active',
    timestamp: Date.now(),
  };

  const receivedPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for remote_stroke_start')), 3000);

    ws2.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'remote_stroke_start') {
        console.log('Client 2 successfully received remote_stroke_start:', msg.stroke.id, 'seq:', msg.stroke.seq);
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  ws1.send(JSON.stringify({ type: 'stroke_start', stroke: strokeTest }));
  await receivedPromise;

  ws1.close();
  ws2.close();
  console.log('All Milestone 2 WebSocket tests PASSED!');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
