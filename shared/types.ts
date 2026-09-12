/**
 * Shared data structures and protocol types for Real-Time Collaborative Canvas
 */

export type ToolType = 'brush' | 'eraser';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  id: string;
  userId: string;
  tool: ToolType;
  color: string;
  width: number;
  points: Point[];
  status: 'active' | 'undone';
  timestamp: number;
  seq?: number; // Monotonic sequence assigned by server
}

export interface User {
  id: string;
  name: string;
  color: string;
  cursor?: {
    x: number;
    y: number;
  };
  lastActive?: number;
}

// Client-to-Server Message Types
export type ClientMessage =
  | { type: 'join'; roomId: string; name?: string }
  | { type: 'cursor_move'; x: number; y: number }
  | { type: 'stroke_start'; stroke: Stroke }
  | { type: 'stroke_chunk'; strokeId: string; points: Point[] }
  | { type: 'stroke_end'; strokeId: string; finalPoints: Point[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'ping'; clientTime: number };

// Server-to-Client Message Types
export type ServerMessage =
  | {
      type: 'init_state';
      userId: string;
      userColor: string;
      userName: string;
      roomId: string;
      users: User[];
      strokes: Stroke[];
    }
  | { type: 'user_joined'; user: User }
  | { type: 'user_left'; userId: string }
  | { type: 'user_renamed'; userId: string; name: string }
  | { type: 'cursor_update'; userId: string; x: number; y: number }
  | { type: 'remote_stroke_start'; stroke: Stroke }
  | { type: 'remote_stroke_chunk'; strokeId: string; points: Point[] }
  | { type: 'remote_stroke_end'; stroke: Stroke }
  | { type: 'history_sync'; strokes: Stroke[]; undoneCount: number }
  | { type: 'pong'; clientTime: number; serverTime: number };
