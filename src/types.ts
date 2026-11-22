export type RoomVisibility = 'public' | 'private';

export interface RoomMember {
  id: string; // Socket ID or permanent User ID
  name: string;
  agent?: string; // e.g. "Omen", "Jett"
  role: 'leader' | 'strategist' | 'member';
  color: string; // Tactical cursor / ping color
  joinedAt: number;
}

export interface BaseCanvasElement {
  id: string;
  type: 'draw' | 'line' | 'arrow' | 'ping' | 'text';
  color: string;
  strokeWidth: number;
  opacity?: number;
}

export interface DrawElement extends BaseCanvasElement {
  type: 'draw';
  points: number[];
}

export interface LineElement extends BaseCanvasElement {
  type: 'line';
  points: [number, number, number, number];
}

export interface ArrowElement extends BaseCanvasElement {
  type: 'arrow';
  points: [number, number, number, number];
  pointerLength?: number;
  pointerWidth?: number;
}

export interface PingElement extends BaseCanvasElement {
  type: 'ping';
  x: number;
  y: number;
  label?: string;
  pingType?: 'danger' | 'move' | 'utility' | 'warning' | 'info';
}

export interface TextElement extends BaseCanvasElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type CanvasElement = DrawElement | LineElement | ArrowElement | PingElement | TextElement;

export interface Room {
  id: string; // Unique room code e.g. "STRAT-8K9P"
  name: string;
  description?: string;
  mapId?: string; // e.g. "ascent"
  visibility: RoomVisibility;
  maxParticipants: number;
  createdAt: number;
  hostId: string;
  members: RoomMember[];
  elements: CanvasElement[];
}

// Client -> Server Events
export interface ClientToServerEvents {
  create_room: (
    data: {
      name: string;
      description?: string;
      mapId?: string;
      visibility?: RoomVisibility;
      maxParticipants?: number;
      userName: string;
    },
    callback: (response: { success: boolean; room?: Room; error?: string }) => void
  ) => void;

  join_room: (
    data: {
      roomId: string;
      userName: string;
    },
    callback: (response: { success: boolean; room?: Room; error?: string }) => void
  ) => void;

  leave_room: (data: { roomId: string }) => void;
  select_map: (data: { roomId: string; mapId: string }) => void;
  cursor_move: (data: { roomId: string; x: number; y: number }) => void;
  cursor_leave: (data: { roomId: string }) => void;

  // Real-time collaborative whiteboard events
  drawing_live: (data: { roomId: string; element: CanvasElement | null }) => void;
  element_commit: (data: { roomId: string; element: CanvasElement }) => void;
  element_delete: (data: { roomId: string; elementId: string }) => void;
  canvas_clear: (data: { roomId: string }) => void;
  canvas_sync: (data: { roomId: string; elements: CanvasElement[] }) => void;
}

// Server -> Client Events
export interface ServerToClientEvents {
  room_joined: (room: Room) => void;
  user_joined: (data: { member: RoomMember; membersCount: number }) => void;
  user_left: (data: { memberId: string; memberName: string; membersCount: number }) => void;
  host_changed: (data: { newHostId: string }) => void;
  error_message: (message: string) => void;
  select_map: (data: { mapId: string }) => void;
  cursor_move: (data: { userId: string; userName: string; color: string; x: number; y: number }) => void;
  cursor_leave: (data: { userId: string }) => void;

  // Real-time collaborative whiteboard events
  drawing_live: (data: { userId: string; element: CanvasElement | null }) => void;
  element_commit: (data: { userId: string; element: CanvasElement }) => void;
  element_delete: (data: { elementId: string }) => void;
  canvas_clear: () => void;
  canvas_sync: (data: { elements: CanvasElement[] }) => void;
}

export interface SocketData {
  userId?: string;
  userName?: string;
  currentRoomId?: string;
}
