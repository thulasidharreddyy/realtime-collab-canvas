import { WebSocket } from 'ws';
import { User, ServerMessage, Stroke, Point } from '../shared/types.js';
import { DrawingState } from './drawing-state.js';

// Curated palette of distinct colors for user cursors and badges
const USER_COLORS = [
  '#2563eb', // Blue
  '#dc2626', // Red
  '#16a34a', // Green
  '#d97706', // Amber
  '#9333ea', // Purple
  '#db2777', // Pink
  '#0891b2', // Cyan
  '#ea580c', // Orange
  '#4f46e5', // Indigo
  '#059669', // Emerald
];

export interface ClientSession {
  ws: WebSocket;
  user: User;
  roomId: string;
}

export class Room {
  public id: string;
  public state: DrawingState;
  public clients: Map<WebSocket, ClientSession> = new Map();
  private colorIndex: number = 0;

  constructor(id: string) {
    this.id = id;
    this.state = new DrawingState();
  }

  /**
   * Allocate a unique color for each new user.
   */
  public allocateColor(): string {
    const color = USER_COLORS[this.colorIndex % USER_COLORS.length];
    this.colorIndex++;
    return color;
  }

  /**
   * Add client to room and return assigned session.
   */
  public addClient(ws: WebSocket, name?: string): ClientSession {
    const userId = `u-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const userColor = this.allocateColor();
    const userName = name || `Artist ${this.clients.size + 1}`;

    const user: User = {
      id: userId,
      name: userName,
      color: userColor,
    };

    const session: ClientSession = {
      ws,
      user,
      roomId: this.id,
    };

    this.clients.set(ws, session);
    return session;
  }

  public removeClient(ws: WebSocket): ClientSession | undefined {
    const session = this.clients.get(ws);
    if (session) {
      this.clients.delete(ws);
    }
    return session;
  }

  public getUsers(): User[] {
    return Array.from(this.clients.values()).map((s) => s.user);
  }

  /**
   * Broadcast message to all connected clients in the room.
   */
  public broadcastAll(message: ServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }

  /**
   * Broadcast message to all connected clients EXCEPT the sender.
   */
  public broadcastOthers(senderWs: WebSocket, message: ServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const [ws] of this.clients) {
      if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  public getOrCreateRoom(roomId: string = 'default'): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }
}
