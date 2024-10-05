import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import fetch from "node-fetch";
import * as dotenv from "dotenv";

dotenv.config();

const httpServer = createServer();

// Define the expected structure of the saved message
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

const io = new SocketIOServer(httpServer, {
  path: "/ws",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room: ${roomId}`);
  });

  socket.on("message", async (messageData) => {
    const { roomId, content, user } = messageData;

    if (!content || !user?.username) {
      console.error(
        `Received malformed message data: ${JSON.stringify(messageData)}`
      );
      return;
    }

    console.log(`Message received in room ${roomId}:`, content);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
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

      io.to(roomId).emit("message", { ...savedMessage, user });
    } catch (error) {
      console.error("Error saving message to the database:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`WebSocket server is running on http://localhost:${PORT}`);
});
