import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const PORT = 3000;

  // WebSocket Server for Signaling
  const wss = new WebSocketServer({ server });

  // Map to track rooms and their participants: Map<roomName, Map<userId, { ws: WebSocket, name: string, isAdmin: boolean }>>
  const rooms = new Map<string, Map<string, { ws: WebSocket, name: string, isAdmin: boolean }>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;
    let currentUserId: string | null = null;

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "join":
          currentRoom = message.room;
          currentUserId = message.userId;
          const userName = message.name;
          const isAdmin = message.isAdmin;
          
          if (!rooms.has(currentRoom!)) {
            rooms.set(currentRoom!, new Map());
          }
          rooms.get(currentRoom!)?.set(currentUserId!, { ws, name: userName, isAdmin });
          
          // Notify others in the room and send existing participants to new joiner
          const existingParticipants: { userId: string, name: string, isAdmin: boolean }[] = [];
          rooms.get(currentRoom!)?.forEach((participant, id) => {
            if (id !== currentUserId) {
              existingParticipants.push({ userId: id, name: participant.name, isAdmin: participant.isAdmin });
              
              if (participant.ws.readyState === WebSocket.OPEN) {
                participant.ws.send(JSON.stringify({
                  type: "user-joined",
                  userId: currentUserId,
                  name: userName,
                  isAdmin
                }));
              }
            }
          });

          // Send the list of existing participants to the new joiner
          ws.send(JSON.stringify({
            type: "participants-list",
            participants: existingParticipants
          }));
          break;

        case "toggle-hand":
        case "toggle-screen-share":
        case "toggle-mic":
        case "toggle-camera":
        case "speaking":
        case "remote-mute":
        case "mute-all":
        case "lower-all-hands":
        case "poll-created":
        case "poll-voted":
        case "question-asked":
        case "question-upvoted":
        case "end-meeting":
          // Broadcast to everyone in the room
          if (currentRoom) {
            rooms.get(currentRoom)?.forEach((participant) => {
              if (participant.ws.readyState === WebSocket.OPEN) {
                participant.ws.send(JSON.stringify(message));
              }
            });
          }
          break;

        case "ping":
          // Ignore heartbeat pings
          break;

        case "offer":
        case "answer":
        case "candidate":
          // Forward signaling messages to specific target user
          if (currentRoom && message.targetUserId) {
            const target = rooms.get(currentRoom)?.get(message.targetUserId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify(message));
            }
          }
          break;

        case "chat":
          // Broadcast chat messages
          rooms.get(currentRoom!)?.forEach((participant) => {
            if (participant.ws.readyState === WebSocket.OPEN) {
              participant.ws.send(JSON.stringify(message));
            }
          });
          break;
      }
    });

    ws.on("close", () => {
      if (currentRoom && currentUserId && rooms.has(currentRoom)) {
        rooms.get(currentRoom)?.delete(currentUserId);
        // Notify others
        rooms.get(currentRoom)?.forEach((participant) => {
          if (participant.ws.readyState === WebSocket.OPEN) {
            participant.ws.send(JSON.stringify({
              type: "user-left",
              userId: currentUserId
            }));
          }
        });
        if (rooms.get(currentRoom)?.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    });
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
