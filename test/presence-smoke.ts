import { WebSocket } from 'ws';

async function testPresence() {
  console.log('Testing User Presence and Cursor Broadcasting...');

  const ws1 = new WebSocket('ws://localhost:3000');
  const ws2 = new WebSocket('ws://localhost:3000');

  let user1Id = '';
  let user2Id = '';

  await new Promise<void>((resolve) => {
    let u1Joined = false;
    let u2Joined = false;

    ws1.on('open', () => {
      ws1.send(JSON.stringify({ type: 'join', roomId: 'presence-room', name: 'Alice' }));
    });

    ws1.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'init_state') {
        user1Id = msg.userId;
        console.log('Alice connected with ID:', user1Id, 'Color:', msg.userColor);
        u1Joined = true;
        if (u2Joined) resolve();
      }
    });

    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'join', roomId: 'presence-room', name: 'Bob' }));
    });

    ws2.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'init_state') {
        user2Id = msg.userId;
        console.log('Bob connected with ID:', user2Id, 'Color:', msg.userColor);
        u2Joined = true;
        if (u1Joined) resolve();
      }
    });
  });

  // Bob moves cursor; Alice should receive Bob's cursor coordinates
  const cursorPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for cursor update')), 3000);

    ws1.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'cursor_update' && msg.userId === user2Id) {
        console.log(`Alice received Bob's cursor at x: ${msg.x}, y: ${msg.y}`);
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  console.log('Bob moving cursor to (140, 260)...');
  ws2.send(JSON.stringify({ type: 'cursor_move', x: 140, y: 260 }));

  await cursorPromise;

  ws1.close();
  ws2.close();
  console.log('All Milestone 3 Presence tests PASSED!');
  process.exit(0);
}

testPresence().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
