import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

/**
 * Highly robust in-memory room store.
 * Replaces expensive, slow, and rule-blocked Firebase Firestore database
 * with instant, zero-latency local state.
 */
interface Room {
  roomCode: string;
  hostId: string;
  status: string;
  players: any[];
  settings: any;
  cards: any[];
  currentTurnIndex: number;
  timerStart: number | null;
  lastEffect: any;
  chatMessage: any;
  clickRequest: any;
  kickedPeerIds: string[];
  lastActivity: number;
}

const rooms = new Map<string, Room>();

// Sweep rooms older than 1 hour to prevent memory expansion
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.lastActivity > 3600000) {
      console.log(`[Sweeper] Cleaning up idle room: ${code}`);
      rooms.delete(code);
    }
  }
}, 300000); // Check every 5 minutes

function deepSetAndMerge(target: any, updates: any) {
  for (const key in updates) {
    const val = updates[key];
    
    // Check if key is a nested dotted path like "clickRequest.processed"
    if (key.includes('.')) {
      const parts = key.split('.');
      let current = target;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part] || typeof current[part] !== 'object') {
          current[part] = {};
        }
        current = current[part];
      }
      const lastPart = parts[parts.length - 1];
      setSingleValue(current, lastPart, val);
    } else {
      setSingleValue(target, key, val);
    }
  }
}

function setSingleValue(parent: any, key: string, val: any) {
  if (val && typeof val === 'object' && val.__type === 'arrayUnion') {
    if (!Array.isArray(parent[key])) {
      parent[key] = [];
    }
    const currentArray = parent[key];
    const itemToUnion = val.value;
    
    // Check if item is already in array checking unique peerId, string, or equivalence
    const alreadyExists = currentArray.some((x: any) => {
      if (typeof x === 'object' && x && itemToUnion && typeof itemToUnion === 'object') {
        const xId = x.peerId || x.id;
        const uId = itemToUnion.peerId || itemToUnion.id;
        if (xId !== undefined && uId !== undefined) {
          return xId === uId;
        }
        return JSON.stringify(x) === JSON.stringify(itemToUnion);
      }
      return x === itemToUnion;
    });
    
    if (!alreadyExists) {
      currentArray.push(itemToUnion);
    }
  } else if (val && typeof val === 'object' && !Array.isArray(val)) {
    if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) {
      parent[key] = {};
    }
    deepSetAndMerge(parent[key], val);
  } else {
    parent[key] = val;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Standard middleware
  app.use(express.json({ limit: "15mb" }));

  // API Healthcheck
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // REST API replacing Firebase Firestore for rooms
  app.post("/api/rooms/:id", (req, res) => {
    const { id } = req.params;
    const roomData = req.body;
    
    roomData.lastActivity = Date.now();
    rooms.set(id, roomData);
    console.log(`[Backend] Room created/set: ${id}`);
    res.json(roomData);
  });

  app.get("/api/rooms/:id", (req, res) => {
    const { id } = req.params;
    const room = rooms.get(id);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    room.lastActivity = Date.now();
    res.json(room);
  });

  app.patch("/api/rooms/:id", (req, res) => {
    const { id } = req.params;
    const room = rooms.get(id);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    try {
      deepSetAndMerge(room, req.body);
      room.lastActivity = Date.now();
      res.json(room);
    } catch (err: any) {
      console.error(`[Backend] Merging error for room ${id}:`, err);
      res.status(500).json({ error: "Failed to merge data update", details: err.message });
    }
  });

  app.delete("/api/rooms/:id", (req, res) => {
    const { id } = req.params;
    const deleted = rooms.delete(id);
    console.log(`[Backend] Room deleted: ${id} (status: ${deleted})`);
    res.json({ success: deleted });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Full-stack memory game running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
