import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import { RateLimiterMemory } from "rate-limiter-flexible"; // Keep rate limiting for spam protection

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
  throw new Error("API URL is not defined. Please check your environment variables.");
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
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Handle room joining
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room: ${roomId}`);
  });

  // Handle incoming messages
  socket.on("message", async (messageData) => {
    const { roomId, content, user } = messageData;

    if (!content || !user?.username) {
      console.error(`Received malformed message data: ${JSON.stringify(messageData)}`);
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
    const sanitizedContent = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server is running on http://localhost:${PORT}`);
});
