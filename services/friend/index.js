import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "./models/user.js";
import Friend from "./models/friend.js";
import client from "prom-client";

dotenv.config();

const PORT = 4003;
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/mingleup";

async function main() {
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Friend Service connected to MongoDB");

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
    try {
      req.user = jwt.verify(match[1], JWT_SECRET);
      next();
    } catch { return res.status(401).json({ error: "Invalid token" }); }
  }

  app.post("/api/friends/add", auth, async (req, res) => {
    const { username, identifier } = req.body || {};
    const ident = identifier || username;
    if (!ident) return res.status(400).json({ error: "username required" });
    try {
      const friend = await User.findOne({ $or: [{ username: ident }, { email: ident }] });
      if (!friend) return res.status(404).json({ error: "User not found" });
      if (friend._id.toString() === req.user.id) return res.status(400).json({ error: "Cannot add yourself" });

      const existing = await Friend.findOne({ user: req.user.id, friend: friend._id });
      if (existing) return res.status(400).json({ error: "Already friends" });

      await new Friend({ user: req.user.id, friend: friend._id }).save();
      try { await new Friend({ user: friend._id, friend: req.user.id }).save(); } catch (e) { }

      res.json({ friend: { id: friend._id.toString(), username: friend.username } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/friends", auth, async (req, res) => {
    try {
      const rows = await Friend.find({ user: req.user.id }).populate('friend', 'username').lean();
      const friends = rows.map(r => ({ id: r.friend._id.toString(), username: r.friend.username }));
      res.json({ friends });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/health", (req, res) => res.json({ status: "Friend Service OK" }));
  app.listen(PORT, "0.0.0.0", () => console.log(`Friend Service running on ${PORT}`));
}
main();
