export type RoomVisibility = 'public' | 'private';

export interface RoomMember {
  id: string; // Socket ID or permanent User ID
  name: string;
  agent?: string; // e.g. "Omen", "Jett"
  role: 'leader' | 'strategist' | 'member';
  color: string; // Tactical cursor / ping color
  joinedAt: number;
}

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
}

// Server -> Client Events
export interface ServerToClientEvents {
  room_joined: (room: Room) => void;
  user_joined: (data: { member: RoomMember; membersCount: number }) => void;
  user_left: (data: { memberId: string; memberName: string; membersCount: number }) => void;
  error_message: (message: string) => void;
}

export interface SocketData {
  userId?: string;
  userName?: string;
  currentRoomId?: string;
}
