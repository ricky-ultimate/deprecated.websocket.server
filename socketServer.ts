import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import { RateLimiterMemory } from "rate-limiter-flexible";

dotenv.config();

const httpServer = createServer();

interface Message {
  id: number;
  content: string;
  userId: number;
  chatRoomId: number;
  createdAt: string;
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
const activeUsers: Record<string, Set<string>> = {}; // Room ID -> Set of usernames

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Track the username of the connected user
  let currentUsername: string | null = null;

  // Handle room joining
  socket.on("joinRoom", (roomId, username) => {
    currentUsername = username; // Store username for this socket
    socket.join(roomId);
    console.log(`Socket ${socket.id} (${username}) joined room: ${roomId}`);

    // Add user to active users list for the room
    if (!activeUsers[roomId]) {
      activeUsers[roomId] = new Set();
    }
    activeUsers[roomId].add(username);

    // Notify other users in the room about the new user
    io.to(roomId).emit("userJoined", { username, roomId });
    console.log(
      `Active users in ${roomId}: ${Array.from(activeUsers[roomId]).join(", ")}`
    );
  });

  // Handle incoming messages
  socket.on("message", async (messageData) => {
    const { roomId, content, user } = messageData;

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

    console.log(
      `Message received in room ${roomId} from ${user.username}:`,
      content
    );

    // Sanitize user inputs (basic sanitization example)
    const sanitizedContent = content
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    try {
      // Use `fetch` to save messages via REST API instead of direct database access
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

      // Emit the saved message to the room (include database info like ID)
      io.to(roomId).emit("message", { ...savedMessage, user });
    } catch (error) {
      console.error("Error saving message to the database:", error);
    }
  });

  // Handle disconnections
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // Remove the user from the active users list in all rooms they were part of
    for (const roomId in activeUsers) {
      if (activeUsers[roomId].has(currentUsername!)) {
        activeUsers[roomId].delete(currentUsername!);
        console.log(
          `User ${currentUsername} removed from active users in room: ${roomId}`
        );

        // Notify remaining users in the room
        io.to(roomId).emit("userLeft", { username: currentUsername, roomId });
      }

      // If no users are left in the room, delete the room entry
      if (activeUsers[roomId].size === 0) {
        delete activeUsers[roomId];
        console.log(`No active users left in room: ${roomId}. Room deleted.`);
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server is running on http://localhost:${PORT}`);
});
