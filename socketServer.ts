// src/websocket-server/socketServer.ts
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import fetch from "node-fetch"; // Use `node-fetch` to make HTTP requests

const httpServer = createServer();

// Define the expected structure of the saved message
interface Message {
  id: number;
  content: string;
  userId: number;
  chatRoomId: number;
  createdAt: string;
}

const io = new SocketIOServer(httpServer, {
  path: "/ws",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Handle WebSocket connections
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Handle joining a room
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room: ${roomId}`);
  });

  // Handle sending/receiving messages
  socket.on("message", async (messageData) => {
    const { roomId, content, user } = messageData;

    if (!content || !user?.username) {
      console.error(`Received malformed message data: ${JSON.stringify(messageData)}`);
      return;
    }

    console.log(`Message received in room ${roomId}:`, content);

    // Save the message to the database using the API route
    try {
      const response = await fetch("http://localhost:3000/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          chatRoomName: roomId, // Use the room ID as the chatRoomName
          user: { username: user.username }, // Include the username for context
        }),
      });

      if (!response.ok) {
        console.error("Failed to save message:", await response.json());
        return;
      }

      // Use type assertion to define the expected structure of the saved message
      const savedMessage = await response.json() as Message;
      console.log("Message saved successfully:", savedMessage);

      // Emit the saved message to the room with the correct structure
      io.to(roomId).emit("message", { ...savedMessage, user });
    } catch (error) {
      console.error("Error saving message to the database:", error);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Start the WebSocket server on port 4000 (or any other port)
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server is running on http://localhost:${PORT}`);
});
