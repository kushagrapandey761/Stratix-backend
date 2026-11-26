import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from './types.js';
import { roomService } from './services/roomService.js';

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

const app = express();

// Middleware
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

// Basic health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'stratix-backend' });
});

// REST endpoint to inspect room status (useful for debugging)
app.get('/api/rooms/:roomId', (req: Request, res: Response) => {
  const room = roomService.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  return res.status(200).json({ room });
});

// Create native HTTP server
const httpServer = http.createServer(app);

// Attach Socket.IO with strict types
const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
  httpServer,
  {
    cors: {
      origin: CLIENT_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  }
);

// Socket.IO event orchestration
io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);
  const isRoomMember = (roomId: string) =>
    roomService.getRoom(roomId)?.members.some((member) => member.id === socket.id) ?? false;

  // 1. Create Room
  socket.on('create_room', (data, callback) => {
    try {
      const result = roomService.createRoom({
        name: data.name,
        description: data.description,
        mapId: data.mapId,
        visibility: data.visibility,
        maxParticipants: data.maxParticipants,
        hostId: socket.id,
        hostName: data.userName,
      });

      if (!result.success || !result.room) {
        return callback({ success: false, error: result.error || 'Failed to create room.' });
      }

      // Join the Socket.IO room channel
      socket.join(result.room.id);
      socket.data.currentRoomId = result.room.id;
      socket.data.userName = data.userName;

      console.log(`[Room Created] ${result.room.id} by ${data.userName} (${socket.id})`);
      callback({ success: true, room: result.room });
    } catch (err) {
      console.error('[create_room error]', err);
      callback({ success: false, error: 'Internal server error while creating room.' });
    }
  });

  // 2. Join Room
  socket.on('join_room', (data, callback) => {
    try {
      const result = roomService.joinRoom({
        roomId: data.roomId,
        userId: socket.id,
        userName: data.userName,
      });

      if (!result.success || !result.room || !result.member) {
        return callback({ success: false, error: result.error || 'Failed to join room.' });
      }

      const roomId = result.room.id;

      // Join the Socket.IO room channel
      socket.join(roomId);
      socket.data.currentRoomId = roomId;
      socket.data.userName = result.member.name;

      console.log(`[User Joined] ${result.member.name} joined room ${roomId}`);

      // Broadcast to other members in the room
      socket.to(roomId).emit('user_joined', {
        member: result.member,
        membersCount: result.room.members.length,
      });

      // Confirm to the caller
      callback({ success: true, room: result.room });
    } catch (err) {
      console.error('[join_room error]', err);
      callback({ success: false, error: 'Internal server error while joining room.' });
    }
  });

  // 3. Leave Room
  socket.on('leave_room', (data) => {
    handleUserLeave(socket, data.roomId);
  });

  socket.on("select_map", (data) => {
    const { roomId, mapId } = data;
    const room = roomService.getRoom(roomId);
    if (room) {
      room.mapId = mapId;
    }
    // Broadcast the map selection to all members in the room
    io.to(roomId).emit("select_map", { mapId });
  });

  socket.on('select_agent', (data, callback) => {
    const respond = (response: { success: boolean; error?: string }) => callback?.(response);
    if (
      !data ||
      typeof data.roomId !== 'string' ||
      (data.agentId !== null &&
        (typeof data.agentId !== 'string' ||
          data.agentId.trim().length === 0 ||
          data.agentId.length > 64 ||
          !Number.isFinite(data.x) ||
          !Number.isFinite(data.y) ||
          data.x < 0 ||
          data.x > 1000 ||
          data.y < 0 ||
          data.y > 1000 ||
          !isValorantAgentIcon(data.agentIcon)))
    ) {
      respond({ success: false, error: 'Invalid agent selection.' });
      return;
    }

    const roomId = data.roomId.trim().toUpperCase();
    const agentId = typeof data.agentId === 'string' ? data.agentId.trim() : null;
    if (!isRoomMember(roomId)) {
      respond({ success: false, error: 'You must be in the room to select an agent.' });
      return;
    }

    const result = roomService.updateMemberAgent(roomId, socket.id, agentId);
    if (!result.success) {
      respond(result);
      return;
    }

    io.to(roomId).emit('select_agent', { userId: socket.id, agentId });
    const agentMarkerId = `agent-${socket.id}`;
    if (agentId === null) {
      roomService.removeElement(roomId, agentMarkerId);
      io.to(roomId).emit('element_delete', { elementId: agentMarkerId });
    } else {
      const room = roomService.getRoom(roomId);
      const member = room?.members.find((roomMember) => roomMember.id === socket.id);
      if (!room || !member || !data.agentIcon) {
        respond({ success: false, error: 'Unable to create the agent marker.' });
        return;
      }

      const agentMarker = {
        id: agentMarkerId,
        type: 'ping' as const,
        color: member.color,
        strokeWidth: 2,
        x: data.x,
        y: data.y,
        label: member.name,
        imageUrl: data.agentIcon,
        ownerId: socket.id,
      };
      roomService.addElement(roomId, agentMarker);
      io.to(roomId).emit('element_commit', { userId: socket.id, element: agentMarker });
    }
    respond({ success: true });
  });

  // 4. Real-time Cursors
  socket.on('cursor_move', (data) => {
    const { roomId, x, y } = data;
    const room = roomService.getRoom(roomId);
    if (!room) return;

    const member = room.members.find((m) => m.id === socket.id);
    const color = member?.color || '#00F0FF';
    const userName = member?.name || socket.data.userName || 'Operator';

    // Broadcast cursor position exclusively to other room members
    socket.to(roomId).emit('cursor_move', {
      userId: socket.id,
      userName,
      color,
      x,
      y,
    });
  });

  socket.on('cursor_leave', (data) => {
    socket.to(data.roomId).emit('cursor_leave', { userId: socket.id });
  });

  // 5. Real-time Collaborative Whiteboard (activeElement & drawings)
  socket.on('drawing_live', (data) => {
    if (!isRoomMember(data.roomId)) return;
    // Broadcast active in-progress drawing preview to all other room operators
    socket.to(data.roomId).emit('drawing_live', {
      userId: socket.id,
      element: data.element,
    });
  });

  socket.on('element_commit', (data) => {
    if (!isRoomMember(data.roomId) || !roomService.addElement(data.roomId, data.element)) return;
    // Broadcast finalized element to all other room operators
    socket.to(data.roomId).emit('element_commit', {
      userId: socket.id,
      element: data.element,
    });
  });

  socket.on('element_delete', (data) => {
    if (!isRoomMember(data.roomId) || !roomService.removeElement(data.roomId, data.elementId)) return;
    socket.to(data.roomId).emit('element_delete', {
      elementId: data.elementId,
    });
  });

  socket.on('canvas_clear', (data) => {
    if (!isRoomMember(data.roomId) || !roomService.clearElements(data.roomId)) return;
    socket.to(data.roomId).emit('canvas_clear');
  });

  socket.on('canvas_sync', (data) => {
    if (!isRoomMember(data.roomId) || !roomService.replaceElements(data.roomId, data.elements)) return;
    socket.to(data.roomId).emit('canvas_sync', { elements: data.elements });
  });

  // 6. WebRTC Voice Signaling & Status Relay
  socket.on('webrtc_signal', (data) => {
    // Relay signaling payload (SDP offer/answer or ICE candidate) directly to the target peer
    io.to(data.to).emit('webrtc_signal', {
      from: socket.id,
      signal: data.signal,
    });
  });

  socket.on('voice_status', (data) => {
    // Broadcast user's mute/speaking status to everyone else in the room
    socket.to(data.roomId).emit('voice_status', {
      userId: socket.id,
      isMuted: data.isMuted,
      isSpeaking: data.isSpeaking,
    });
  });

  // 7. Disconnect
  socket.on('disconnect', (reason) => {
    console.log(`[Socket Disconnected] ID: ${socket.id}, reason: ${reason}`);
    const { roomId } = roomService.findUserRoom(socket.id);
    if (roomId) {
      handleUserLeave(socket, roomId);
    }
  });
});

function isValorantAgentIcon(iconUrl: string | null): boolean {
  if (!iconUrl) return false;

  try {
    const url = new URL(iconUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'media.valorant-api.com' &&
      /^\/agents\/[^/]+\/[^/]+$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Common handler for a socket leaving a room
 */
function handleUserLeave(socket: any, roomId: string) {
  const previousHostId = roomService.getRoom(roomId)?.hostId;
  const { room, removedMember, roomDeleted } = roomService.removeUserFromRoom(roomId, socket.id);
  socket.leave(roomId);
  socket.data.currentRoomId = undefined;

  const agentMarkerId = `agent-${socket.id}`;
  if (room && !roomDeleted && room.elements.some((element) => element.id === agentMarkerId)) {
    roomService.removeElement(roomId, agentMarkerId);
    io.to(roomId).emit('element_delete', { elementId: agentMarkerId });
  }

  // Inform clients to remove this user's cursor & any in-progress drawing
  io.to(roomId).emit('cursor_leave', { userId: socket.id });
  io.to(roomId).emit('drawing_live', { userId: socket.id, element: null });

  if (removedMember && !roomDeleted && room) {
    console.log(`[User Left] ${removedMember.name} left room ${roomId}`);
    io.to(roomId).emit('user_left', {
      memberId: removedMember.id,
      memberName: removedMember.name,
      membersCount: room.members.length,
    });
    if (room.hostId !== previousHostId) {
      io.to(roomId).emit('host_changed', { newHostId: room.hostId });
    }
  } else if (roomDeleted) {
    console.log(`[Room Deleted] Room ${roomId} was closed (all members left).`);
  }
}

// Start Server
httpServer.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 STRATIX Tactical Backend Running!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 Allowed Origin: ${CLIENT_ORIGIN}`);
  console.log(`=========================================`);
});
