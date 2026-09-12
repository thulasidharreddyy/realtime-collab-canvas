import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../shared/types.js';
import { RoomManager, ClientSession } from './rooms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const CLIENT_DIST = path.resolve(__dirname, '../dist/client');

// MIME types for static asset serving
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 1. Create HTTP Server to serve static client bundle
const httpServer = http.createServer((req, res) => {
  const urlPath = req.url?.split('?')[0] || '/';
  let filePath = path.join(CLIENT_DIST, urlPath === '/' ? 'index.html' : urlPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(CLIENT_DIST)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Single-Page Application (SPA) fallback to index.html
      filePath = path.join(CLIENT_DIST, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found - Please build client with `npm run build`');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

// 2. Attach WebSocket Server to the same HTTP server
const wss = new WebSocketServer({ server: httpServer });
const roomManager = new RoomManager();

// Track session for each connected socket
const socketSessions = new Map<WebSocket, ClientSession>();

wss.on('connection', (ws: WebSocket) => {
  let session: ClientSession | null = null;
  let currentRoom = roomManager.getOrCreateRoom('default');

  ws.on('message', (raw: string | Buffer) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'join': {
          const roomId = msg.roomId || 'default';
          currentRoom = roomManager.getOrCreateRoom(roomId);
          session = currentRoom.addClient(ws, msg.name);
          socketSessions.set(ws, session);

          // 1. Send initial state to newly connected client
          const initMsg: ServerMessage = {
            type: 'init_state',
            userId: session.user.id,
            userColor: session.user.color,
            userName: session.user.name,
            roomId: currentRoom.id,
            users: currentRoom.getUsers(),
            strokes: currentRoom.state.getStrokes(),
          };
          ws.send(JSON.stringify(initMsg));

          // 2. Notify all existing room members about new user
          const userJoinedMsg: ServerMessage = {
            type: 'user_joined',
            user: session.user,
          };
          currentRoom.broadcastOthers(ws, userJoinedMsg);
          break;
        }

        case 'cursor_move': {
          if (!session) return;
          session.user.cursor = { x: msg.x, y: msg.y };
          session.user.lastActive = Date.now();

          const cursorMsg: ServerMessage = {
            type: 'cursor_update',
            userId: session.user.id,
            x: msg.x,
            y: msg.y,
          };
          currentRoom.broadcastOthers(ws, cursorMsg);
          break;
        }

        case 'stroke_start': {
          if (!session) return;
          // Store stroke on server with authoritative sequence number
          const authoritativeStroke = currentRoom.state.addStrokeStart(msg.stroke);

          // Broadcast to other peers to begin rendering stroke incrementally
          const remoteStartMsg: ServerMessage = {
            type: 'remote_stroke_start',
            stroke: authoritativeStroke,
          };
          currentRoom.broadcastOthers(ws, remoteStartMsg);
          break;
        }

        case 'stroke_chunk': {
          if (!session) return;
          // Append points to server state
          currentRoom.state.addStrokeChunk(msg.strokeId, msg.points);

          // Stream intermediate points to other peers
          const remoteChunkMsg: ServerMessage = {
            type: 'remote_stroke_chunk',
            strokeId: msg.strokeId,
            points: msg.points,
          };
          currentRoom.broadcastOthers(ws, remoteChunkMsg);
          break;
        }

        case 'stroke_end': {
          if (!session) return;
          // Finalize stroke
          const completedStroke = currentRoom.state.finalizeStroke(msg.strokeId, msg.finalPoints);
          if (completedStroke) {
            const remoteEndMsg: ServerMessage = {
              type: 'remote_stroke_end',
              stroke: completedStroke,
            };
            currentRoom.broadcastOthers(ws, remoteEndMsg);
          }
          break;
        }

        case 'undo': {
          if (!session) return;
          currentRoom.state.undo();
          const historyMsg: ServerMessage = {
            type: 'history_sync',
            strokes: currentRoom.state.getStrokes(),
            undoneCount: currentRoom.state.getRedoCount(),
          };
          currentRoom.broadcastAll(historyMsg);
          break;
        }

        case 'redo': {
          if (!session) return;
          currentRoom.state.redo();
          const historyMsg: ServerMessage = {
            type: 'history_sync',
            strokes: currentRoom.state.getStrokes(),
            undoneCount: currentRoom.state.getRedoCount(),
          };
          currentRoom.broadcastAll(historyMsg);
          break;
        }

        case 'clear': {
          if (!session) return;
          currentRoom.state.clear();
          const historyMsg: ServerMessage = {
            type: 'history_sync',
            strokes: currentRoom.state.getStrokes(),
            undoneCount: currentRoom.state.getRedoCount(),
          };
          currentRoom.broadcastAll(historyMsg);
          break;
        }

        case 'ping': {
          const pongMsg: ServerMessage = {
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          };
          ws.send(JSON.stringify(pongMsg));
          break;
        }
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (session) {
      currentRoom.removeClient(ws);
      socketSessions.delete(ws);

      const userLeftMsg: ServerMessage = {
        type: 'user_left',
        userId: session.user.id,
      };
      currentRoom.broadcastOthers(ws, userLeftMsg);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket connection error:', err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
