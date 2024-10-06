import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import jwt, { JwtPayload } from "jsonwebtoken";
import { RateLimiterMemory } from "rate-limiter-flexible"; // Import rate limiting
import { prisma } from "./prisma.js";

dotenv.config();

const httpServer = createServer();

interface Message {
  id: number;
  content: string;
  userId: number;
  chatRoomId: number;
  createdAt: string;
  messageType: string;
}

const API_URL: string =
  process.env.NODE_ENV === "production"
    ? process.env.PROD_API_URL || ""
    : process.env.LOCAL_API_URL || "";

if (!API_URL) {
  throw new Error(
    "API URL is not defined. Please check your environment variables."
  );
}

// JWT Secret for verifying tokens
const JWT_SECRET = process.env.JWT_SECRET || "defaultSecret";

// Rate limiter configuration (5 messages per 10 seconds)
const rateLimiter = new RateLimiterMemory({
  points: 5, // 5 messages
  duration: 10, // per 10 seconds
});

// Initialize Socket.IO server
const io = new SocketIOServer(httpServer, {
  path: "/ws",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Track active rooms and users
const activeUsers: Record<string, Set<string>> = {};

// JWT validation middleware for WebSocket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error: Missing token"));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    socket.data.username = decoded.username;
    next();
  } catch (err) {
    return next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", (socket) => {
  const username = socket.data.username;
  console.log(`New client connected: ${socket.id} as ${username}`);

  socket.on("joinRoom", async (roomId) => {
    try {
      // Check if the user is a member of the room
      const membership = await prisma.chatRoomMembership.findFirst({
        where: {
          chatRoom: { name: roomId },
          user: { username },
        },
      });

      if (!membership) {
        socket.emit(
          "error",
          "Access Denied: You are not a member of this room."
        );
        return;
      }

      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room: ${roomId}`);

      // Track active users in the room
      if (!activeUsers[roomId]) {
        activeUsers[roomId] = new Set();
      }
      activeUsers[roomId].add(username);

      // Notify the room about the new member
      io.to(roomId).emit("userJoined", {
        user: username,
        message: `${username} has joined the room.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error checking membership:", error);
      socket.emit("error", "Failed to join room due to a server error.");
    }
  });

  socket.on("message", async (messageData) => {
    const { roomId, content, user, messageType = "text" } = messageData;

    if (!content || !user?.username) {
      console.error(
        `Received malformed message data: ${JSON.stringify(messageData)}`
      );
      return;
    }

    // Rate limit the messages to prevent spamming
    try {
      await rateLimiter.consume(socket.id);
    } catch (rateLimiterRes) {
      socket.emit("error", "Rate limit exceeded. Please slow down.");
      return;
    }

    console.log(`Message received in room ${roomId}:`, content);

    // Sanitize user inputs (basic sanitization example)
    const sanitizedContent = content
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: sanitizedContent,
          chatRoomName: roomId,
          user: { username: user.username },
        }),
      });

      if (!response.ok) {
        console.error("Failed to save message:", await response.json());
        return;
      }

      const savedMessage = (await response.json()) as Message;
      console.log("Message saved successfully:", savedMessage);

      // Include additional metadata for scalability
      io.to(roomId).emit("message", {
        ...savedMessage,
        user,
        messageType,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error saving message to the database:", error);
    }
  });

  socket.on("leaveRoom", (roomId) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room: ${roomId}`);

    if (activeUsers[roomId]) {
      activeUsers[roomId].delete(username);
      if (activeUsers[roomId].size === 0) {
        delete activeUsers[roomId];
      }

      // Notify the room about the member leaving
      io.to(roomId).emit("userLeft", {
        user: username,
        message: `${username} has left the room.`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // Clean up active user tracking for all rooms
    for (const roomId in activeUsers) {
      activeUsers[roomId].delete(username);
      if (activeUsers[roomId].size === 0) {
        delete activeUsers[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server is running on http://localhost:${PORT}`);
});
