import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import client from "prom-client";

dotenv.config();

const PORT = 4005;

async function main() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });
  app.get('/metrics', async (req, res) => res.send(await register.metrics()));

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const subs = new Map();

  function broadcastToChat(chatId, payload) {
    const msg = JSON.stringify(payload);
    for (const [ws, set] of subs.entries()) {
      if (set.has(chatId) && ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  // Internal endpoint for other services to trigger broadcast
  app.post("/internal/notify", (req, res) => {
    const { chatId, message } = req.body;
    if (chatId && message) {
      broadcastToChat(chatId, { type: "message", message });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Missing data" });
    }
  });

  wss.on("connection", (ws) => {
    subs.set(ws, new Set());
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "subscribe" && msg.chatId) {
          subs.get(ws).add(msg.chatId);
          ws.send(JSON.stringify({ type: "subscribed", chatId: msg.chatId }));
        }
        if (msg.type === "unsubscribe" && msg.chatId) {
          subs.get(ws).delete(msg.chatId);
        }
      } catch (e) { }
    });
    ws.on("close", () => subs.delete(ws));
  });

  app.get("/health", (req, res) => res.json({ status: "Realtime Service OK" }));

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Realtime Service listening on port ${PORT}`);
  });
}

main();
