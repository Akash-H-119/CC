import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import Message from "./models/message.js";
import client from "prom-client";
import axios from "axios";

dotenv.config();

const PORT = 4004;
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret";
const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY || "dev_key_32_bytes_long_for_demo!!").padEnd(32).slice(0, 32);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/mingleup";
const REALTIME_SERVICE_URL = process.env.REALTIME_SERVICE_URL || "http://realtime:4005";

function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY), iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { data: Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64"), iv: iv.toString("base64") };
}

function decrypt(dataBase64, ivBase64) {
  const iv = Buffer.from(ivBase64, "base64");
  const combined = Buffer.from(dataBase64, "base64");
  const tag = combined.slice(combined.length - 16);
  const encrypted = combined.slice(0, combined.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function main() {
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Message Service connected to MongoDB");

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });
  app.get('/metrics', async (req, res) => res.send(await register.metrics()));

  function auth(req, res, next) {
    const authHeader = req.headers["authorization"] || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: "Missing token" });
    try { req.user = jwt.verify(match[1], JWT_SECRET); next(); } catch { return res.status(401).json({ error: "Invalid token" }); }
  }

  app.post("/api/messages", auth, async (req, res) => {
    const { chatId, content } = req.body || {};
    if (!chatId || !content) return res.status(400).json({ error: "chatId and content required" });
    try {
      const { data, iv } = encrypt(content);
      const msg = new Message({ chatId, sender: req.user.id, content: data, iv, createdAt: Date.now() });
      await msg.save();

      const message = {
        id: msg._id.toString(),
        chat_id: msg.chatId,
        sender_id: req.user.id,
        content: content,
        created_at: msg.createdAt
      };

      // Notify Realtime Service
      try {
        await axios.post(`${REALTIME_SERVICE_URL}/internal/notify`, { chatId, message });
      } catch (e) {
        console.error("Failed to notify realtime service:", e.message);
      }

      res.json({ message });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/messages", auth, async (req, res) => {
    const chatId = req.query.chatId;
    if (!chatId) return res.status(400).json({ error: "chatId required" });
    try {
      const rows = await Message.find({ chatId }).sort({ createdAt: 1 }).lean();
      const messages = rows.map(r => ({
        id: r._id.toString(), chat_id: r.chatId, sender_id: r.sender.toString(),
        content: decrypt(r.content, r.iv), created_at: r.createdAt
      }));
      res.json({ messages });
    } catch (err) { res.status(500).json({ error: "Internal server error" }); }
  });

  app.delete("/api/messages/clear", auth, async (req, res) => {
    const { chatId } = req.body || {};
    if (!chatId) return res.status(400).json({ error: "chatId required" });
    // Basic auth check: is user in chat ID?
    if (!chatId.includes(req.user.id)) return res.status(403).json({ error: "Not authorized" });
    await Message.deleteMany({ chatId });
    res.json({ message: "Chat cleared" });
  });

  app.get("/health", (req, res) => res.json({ status: "Message Service OK" }));
  app.listen(PORT, "0.0.0.0", () => console.log(`Message Service running on ${PORT}`));
}
main();
