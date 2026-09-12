import { Stroke, Point } from '../shared/types.js';

export interface CommandRecord {
  type: 'stroke' | 'clear';
  strokeIds: string[];
  timestamp: number;
}

export class DrawingState {
  public strokes: Stroke[] = [];
  private seqCounter: number = 0;
  // Command-level redo stack supporting both individual strokes and bulk clear operations
  public redoStack: CommandRecord[] = [];

  constructor() {}

  /**
   * Register a new stroke when a client starts drawing.
   * Assigns an authoritative monotonic sequence number.
   */
  public addStrokeStart(stroke: Stroke): Stroke {
    this.seqCounter++;
    const authoritativeStroke: Stroke = {
      ...stroke,
      seq: this.seqCounter,
      status: 'active',
      points: [...stroke.points],
    };

    this.strokes.push(authoritativeStroke);

    // Any new drawing action invalidates the redo branch
    this.redoStack = [];

    return authoritativeStroke;
  }

  /**
   * Append incoming streamed points to an existing in-progress stroke.
   */
  public addStrokeChunk(strokeId: string, points: Point[]): void {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (stroke) {
      stroke.points.push(...points);
    }
  }

  /**
   * Finalize points for a completed stroke.
   */
  public finalizeStroke(strokeId: string, finalPoints?: Point[]): Stroke | undefined {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (stroke && finalPoints && finalPoints.length > 0) {
      stroke.points = finalPoints;
    }
    return stroke;
  }

  /**
   * Global Undo:
   * Reverses the most recent action in the shared timeline.
   * If the last action was a bulk clear, restores all cleared strokes.
   * If the last action was a stroke, deactivates that stroke.
   */
  public undo(): CommandRecord | null {
    // 1. Scan backwards for the latest active stroke
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].status === 'active') {
        this.strokes[i].status = 'undone';
        const record: CommandRecord = {
          type: 'stroke',
          strokeIds: [this.strokes[i].id],
          timestamp: Date.now(),
        };
        this.redoStack.push(record);
        return record;
      }
    }
    return null;
  }

  /**
   * Global Redo:
   * Pops the last undone command from the redo stack and re-activates its strokes.
   */
  public redo(): CommandRecord | null {
    const record = this.redoStack.pop();
    if (!record) return null;

    if (record.type === 'stroke') {
      for (const id of record.strokeIds) {
        const stroke = this.strokes.find((s) => s.id === id);
        if (stroke) {
          stroke.status = 'active';
        }
      }
      return record;
    } else if (record.type === 'clear') {
      // Re-clear the strokes
      for (const id of record.strokeIds) {
        const stroke = this.strokes.find((s) => s.id === id);
        if (stroke) {
          stroke.status = 'undone';
        }
      }
      return record;
    }

    return null;
  }

  /**
   * Clear all strokes in the room as an undoable atomic command.
   */
  public clear(): CommandRecord | null {
    const activeIds: string[] = [];
    for (const stroke of this.strokes) {
      if (stroke.status === 'active') {
        stroke.status = 'undone';
        activeIds.push(stroke.id);
      }
    }

    if (activeIds.length === 0) return null;

    // Push clear command onto undo stack implicitly
    // Undo will restore these activeIds!
    return {
      type: 'clear',
      strokeIds: activeIds,
      timestamp: Date.now(),
    };
  }

  /**
   * Get count of redoable actions
   */
  public getRedoCount(): number {
    return this.redoStack.length;
  }

  /**
   * Get all strokes in authoritative sequence order.
   */
  public getStrokes(): Stroke[] {
    return this.strokes;
  }
}
