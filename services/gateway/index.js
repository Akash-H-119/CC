import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";
import client from "prom-client";

dotenv.config();
const PORT = 4000;

const app = express();
app.use(cors({ origin: true, credentials: true }));

const register = new client.Registry();
client.collectDefaultMetrics({ register });
app.get('/metrics', async (req, res) => res.send(await register.metrics()));

// Proxy routes
app.use("/api/register", createProxyMiddleware({ target: "http://auth:4001", changeOrigin: true }));
app.use("/api/login", createProxyMiddleware({ target: "http://auth:4001", changeOrigin: true }));

app.use("/api/users", createProxyMiddleware({ target: "http://user:4002", changeOrigin: true }));
app.use("/api/friends", createProxyMiddleware({ target: "http://friend:4003", changeOrigin: true }));
app.use("/api/messages", createProxyMiddleware({ target: "http://message:4004", changeOrigin: true }));

// WS Proxy (requires special handling or just route / to realtime)
app.use("/", createProxyMiddleware({ target: "http://realtime:4005", changeOrigin: true, ws: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gateway Service listening on port ${PORT}`);
});
