import { CanvasElement, PublicRoomSummary, Room, RoomMember, RoomVisibility } from '../types.js';

// Tactical colors assigned to members in order
const TACTICAL_COLORS = [
  '#FF4655', // Red (Host)
  '#00F0FF', // Cyan
  '#A855F7', // Purple
  '#22C55E', // Green
  '#EAB308', // Yellow
  '#EC4899', // Pink
  '#3B82F6', // Blue
  '#F97316', // Orange
];

export class RoomService {
  // In-memory store: roomId -> Room
  private rooms: Map<string, Room> = new Map();
  // Timers for empty room garbage collection: roomId -> Timeout
  private deletionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Helper to generate tactical room code: STRAT-XXXX
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = 'STRAT-';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Ensure uniqueness
    if (this.rooms.has(result)) {
      return this.generateRoomCode();
    }
    return result;
  }

  private cancelRoomDeletion(roomId: string) {
    const timer = this.deletionTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.deletionTimers.delete(roomId);
      console.log(`[Room Preserved] Room ${roomId} cancellation timer cleared.`);
    }
  }

  private scheduleRoomDeletion(roomId: string, delayMs = 60000) {
    this.cancelRoomDeletion(roomId);
    const timer = setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (room && room.members.length === 0) {
        this.rooms.delete(roomId);
        console.log(`[Room Expired] Room ${roomId} pruned after ${delayMs / 1000}s grace period.`);
      }
      this.deletionTimers.delete(roomId);
    }, delayMs);
    this.deletionTimers.set(roomId, timer);
  }

  /**
   * Create a new room and add the creator as the first member (Leader)
   */
  public createRoom(params: {
    name: string;
    description?: string;
    mapId?: string;
    visibility?: RoomVisibility;
    maxParticipants?: number;
    hostId: string;
    hostName: string;
  }): { success: boolean; room?: Room; error?: string } {
    if (!params.name || params.name.trim().length === 0) {
      return { success: false, error: 'Room name cannot be empty.' };
    }

    const roomId = this.generateRoomCode();
    const hostMember: RoomMember = {
      id: params.hostId,
      name: params.hostName.trim() || 'Tactical Leader',
      role: 'leader',
      color: TACTICAL_COLORS[0],
      joinedAt: Date.now(),
    };

    const newRoom: Room = {
      id: roomId,
      name: params.name.trim(),
      description: params.description?.trim(),
      mapId: params.mapId?.trim() || 'ascent',
      visibility: params.visibility || 'private',
      maxParticipants: Math.min(Math.max(params.maxParticipants || 5, 2), 10),
      createdAt: Date.now(),
      hostId: params.hostId,
      members: [hostMember],
      elements: [],
    };

    this.rooms.set(roomId, newRoom);
    return { success: true, room: newRoom };
  }

  /**
   * Join an existing room
   */
  public joinRoom(params: {
    roomId: string;
    userId: string;
    userName: string;
  }): { success: boolean; room?: Room; member?: RoomMember; error?: string } {
    const formattedId = params.roomId.trim().toUpperCase();
    const room = this.rooms.get(formattedId);

    if (!room) {
      return { success: false, error: `Room ${formattedId} not found or expired.` };
    }

    // Cancel deletion timer since someone is joining
    this.cancelRoomDeletion(formattedId);

    // Check if user already in room
    const existingMember = room.members.find((m) => m.id === params.userId);
    if (existingMember) {
      return { success: true, room, member: existingMember };
    }

    // Check capacity
    if (room.members.length >= room.maxParticipants) {
      return { success: false, error: 'Room has reached maximum tactical capacity.' };
    }

    // Assign color based on current member count
    const color = TACTICAL_COLORS[room.members.length % TACTICAL_COLORS.length];

    const newMember: RoomMember = {
      id: params.userId,
      name: params.userName.trim() || `Agent-${room.members.length + 1}`,
      role: 'member',
      color,
      joinedAt: Date.now(),
    };

    room.members.push(newMember);
    return { success: true, room, member: newMember };
  }

  /**
   * Get a room by ID
   */
  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  public getPublicRooms(): PublicRoomSummary[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.visibility === 'public' && room.members.length > 0)
      .map(({ id, name, description, mapId, maxParticipants, createdAt, members }) => ({
        id,
        name,
        description,
        mapId,
        maxParticipants,
        createdAt,
        memberCount: members.length,
      }));
  }

  public updateMemberAgent(
    roomId: string,
    userId: string,
    agentId: string | null
  ): { success: boolean; error?: string } {
    const room = this.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found.' };

    const member = room.members.find((roomMember) => roomMember.id === userId);
    if (!member) return { success: false, error: 'You must be in the room to select an agent.' };

    if (agentId && room.members.some((roomMember) => roomMember.id !== userId && roomMember.agent === agentId)) {
      return { success: false, error: 'That agent has already been selected by another operator.' };
    }

    if (agentId === null) {
      delete member.agent;
    } else {
      member.agent = agentId;
    }

    return { success: true };
  }

  /**
   * Add or update an element in the room's persistent canvas state
   */
  public addElement(roomId: string, element: CanvasElement): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    if (!room.elements) room.elements = [];
    const index = room.elements.findIndex((e) => e.id === element.id);
    if (index >= 0) {
      room.elements[index] = element;
    } else {
      room.elements.push(element);
    }
    return true;
  }

  /**
   * Delete an element by ID
   */
  public removeElement(roomId: string, elementId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room || !room.elements) return false;
    room.elements = room.elements.filter((e) => e.id !== elementId);
    return true;
  }

  /**
   * Clear all elements from the room canvas
   */
  public clearElements(roomId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    room.elements = [];
    return true;
  }

  /**
   * Replace the room canvas with a synchronized undo/redo state
   */
  public replaceElements(roomId: string, elements: CanvasElement[]): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    room.elements = elements;
    return true;
  }

  /**
   * Handle user departure or disconnect
   */
  public removeUserFromRoom(
    roomId: string,
    userId: string
  ): { room?: Room; removedMember?: RoomMember; roomDeleted?: boolean } {
    const formattedId = roomId.toUpperCase();
    const room = this.rooms.get(formattedId);

    if (!room) {
      return {};
    }

    const memberIndex = room.members.findIndex((m) => m.id === userId);
    if (memberIndex === -1) {
      return { room };
    }

    const [removedMember] = room.members.splice(memberIndex, 1);

    // If room is empty, do not delete instantly; schedule a 60-second grace period
    // to allow user route transitions or tab reloads without destroying the room
    if (room.members.length === 0) {
      this.scheduleRoomDeletion(formattedId, 60000);
      return { room, removedMember, roomDeleted: false };
    }

    // If host left, elect the next oldest member as leader
    if (room.hostId === userId && room.members.length > 0) {
      room.hostId = room.members[0].id;
      room.members[0].role = 'leader';
    }

    return { room, removedMember, roomDeleted: false };
  }

  /**
   * Find which room a socket/user is in
   */
  public findUserRoom(userId: string): { roomId?: string; member?: RoomMember } {
    for (const [roomId, room] of this.rooms.entries()) {
      const member = room.members.find((m) => m.id === userId);
      if (member) {
        return { roomId, member };
      }
    }
    return {};
  }
}

// Export singleton instance
export const roomService = new RoomService();
