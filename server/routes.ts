import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { whatsappService } from "./whatsapp";
import { sessionManager } from "./session-manager";
import { transferQueue } from "./transfer-queue";
import { getRecentLogs } from "./transfer-logger";
import { log } from "./index";
import { requireAuth, requireAdmin, hashPassword } from "./auth";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import passport from "passport";
import type { WSMessage, WhatsAppStatus, TransferProgress } from "@shared/schema";

interface AuthenticatedWS extends WebSocket {
  userId?: number;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clients = new Set<AuthenticatedWS>();

  function broadcastToUser(userId: number, message: WSMessage) {
    const data = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.userId === userId) {
        client.send(data);
      }
    });
  }

  function broadcastToAll(message: WSMessage) {
    const data = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  sessionManager.setCallbacks({
    onStatusChange: (sessionId: string, status: WhatsAppStatus) => {
      const userId = sessionManager.getSessionUserId(sessionId);
      if (userId === undefined) return;
      broadcastToUser(userId, { type: "sessions_update", data: sessionManager.getSessionsInfo(userId) });
      const globalStatus = whatsappService.getStatus(userId);
      broadcastToUser(userId, { type: "status", data: globalStatus });
    },
    onQRCode: (sessionId: string, qrDataUrl: string) => {
      const userId = sessionManager.getSessionUserId(sessionId);
      if (userId === undefined) return;
      broadcastToUser(userId, { type: "qr_code", data: { sessionId, qrDataUrl } });
      const primaryId = whatsappService.getPrimarySessionId(userId);
      if (sessionId === primaryId) {
        broadcastToUser(userId, { type: "qr_code", data: qrDataUrl });
      }
    },
  });

  transferQueue.setCallbacks(
    (progress: TransferProgress) => {
      const userId = transferQueue.getCurrentUserId();
      if (userId) {
        broadcastToUser(userId, { type: "transfer_progress", data: progress });
      } else {
        broadcastToAll({ type: "transfer_progress", data: progress });
      }
    },
    (queueStatus) => {
      const userId = transferQueue.getCurrentUserId();
      if (userId) {
        broadcastToUser(userId, { type: "queue_update", data: queueStatus });
      } else {
        broadcastToAll({ type: "queue_update", data: queueStatus });
      }
    }
  );

  wss.on("connection", (ws: AuthenticatedWS, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const userIdParam = url.searchParams.get("userId");
    const userId = userIdParam ? parseInt(userIdParam, 10) : undefined;
    ws.userId = userId;

    clients.add(ws);
    log("WebSocket client connected", "websocket");

    if (userId !== undefined) {
      const currentStatus = whatsappService.getStatus(userId);
      ws.send(JSON.stringify({ type: "status", data: currentStatus }));

      if (currentStatus === "qr_code") {
        const qrDataUrl = whatsappService.getQRDataUrl(userId);
        if (qrDataUrl) {
          ws.send(JSON.stringify({ type: "qr_code", data: qrDataUrl }));
        }
      }

      ws.send(JSON.stringify({ type: "sessions_update", data: sessionManager.getSessionsInfo(userId) }));
    }

    const queueOwner = transferQueue.getCurrentUserId();
    if (userId !== undefined && (queueOwner === userId || queueOwner === 0)) {
      const currentProgress = whatsappService.getCurrentProgress();
      if (currentProgress && currentProgress.status === "in_progress") {
        ws.send(JSON.stringify({ type: "transfer_progress", data: currentProgress }));
      }
      ws.send(JSON.stringify({ type: "queue_update", data: transferQueue.getQueueStatus() }));
    }

    ws.on("close", () => {
      clients.delete(ws);
      log("WebSocket client disconnected", "websocket");
    });
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Credenciais inválidas" });
      req.logIn(user, (err) => {
        if (err) return next(err);
        return res.json({
          id: user.id,
          username: user.username,
          role: user.role,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Erro ao sair" });
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autorizado" });
    res.json({
      id: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
    });
  });

  app.post("/api/whatsapp/connect", requireAuth, async (req, res) => {
    try {
      await whatsappService.initialize(req.user!.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/whatsapp/disconnect", requireAuth, async (req, res) => {
    try {
      await whatsappService.disconnect(req.user!.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/whatsapp/status", requireAuth, (req, res) => {
    res.json({ status: whatsappService.getStatus(req.user!.id) });
  });

  app.get("/api/whatsapp/groups", requireAuth, async (req, res) => {
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Tempo limite excedido ao carregar grupos. Tente novamente.")), 130000));
      const groups = await Promise.race([whatsappService.getGroups(req.user!.id), timeout]);
      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/whatsapp/groups/:groupId/participants", requireAuth, async (req, res) => {
    try {
      const participants = await whatsappService.getGroupParticipants(
        req.params.groupId,
        req.user!.id
      );
      res.json(participants);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/whatsapp/contacts", requireAuth, async (req, res) => {
    try {
      const contacts = await whatsappService.getContacts(req.user!.id);
      res.json(contacts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/whatsapp/transfer", requireAuth, async (req, res) => {
    try {
      const { sourceGroupId, targetGroupId, participantIds, mode } = req.body;

      if (!targetGroupId || !participantIds?.length) {
        return res.status(400).json({
          message: "Dados incompletos. Selecione o grupo de destino e os membros.",
        });
      }

      if (sourceGroupId && sourceGroupId === targetGroupId) {
        return res.status(400).json({
          message: "Grupo de origem e destino devem ser diferentes.",
        });
      }

      const transferMode = mode === "direct" ? "direct" : "invite";
      const userId = req.user!.id;

      whatsappService
        .transferMembers(sourceGroupId || null, targetGroupId, participantIds, transferMode, userId)
        .catch((err: any) => {
          log(`Transfer error: ${err.message}`, "whatsapp");
          broadcastToUser(userId, {
            type: "error",
            data: err.message || "Erro durante a transferência",
          });
        });

      res.json({ success: true, message: "Transferência iniciada" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/whatsapp/transfer/pause", requireAuth, (req, res) => {
    const queueOwner = transferQueue.getCurrentUserId();
    if (queueOwner && queueOwner !== req.user!.id && req.user!.role !== "admin") {
      return res.status(403).json({ message: "Sem permissão para pausar esta transferência" });
    }
    whatsappService.pauseTransfer();
    res.json({ success: true });
  });

  app.post("/api/whatsapp/transfer/resume", requireAuth, (req, res) => {
    const queueOwner = transferQueue.getCurrentUserId();
    if (queueOwner && queueOwner !== req.user!.id && req.user!.role !== "admin") {
      return res.status(403).json({ message: "Sem permissão para retomar esta transferência" });
    }
    whatsappService.resumeTransfer();
    res.json({ success: true });
  });

  app.post("/api/whatsapp/transfer/stop", requireAuth, (req, res) => {
    const queueOwner = transferQueue.getCurrentUserId();
    if (queueOwner && queueOwner !== req.user!.id && req.user!.role !== "admin") {
      return res.status(403).json({ message: "Sem permissão para parar esta transferência" });
    }
    whatsappService.stopTransfer();
    res.json({ success: true });
  });

  app.post("/api/sessions/add", requireAuth, async (req, res) => {
    try {
      const sessionId = await sessionManager.addSession(req.user!.id);
      res.json({ success: true, sessionId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sessions/:id/remove", requireAuth, async (req, res) => {
    try {
      await sessionManager.removeSession(req.params.id, req.user!.id);
      broadcastToUser(req.user!.id, { type: "sessions_update", data: sessionManager.getSessionsInfo(req.user!.id) });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sessions", requireAuth, (req, res) => {
    res.json(sessionManager.getSessionsInfo(req.user!.id));
  });

  app.get("/api/queue/status", requireAuth, (_req, res) => {
    res.json(transferQueue.getQueueStatus());
  });

  app.get("/api/logs/recent", requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(getRecentLogs(limit));
  });

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      }).from(users);
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Usuário e senha são obrigatórios" });
      }
      const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (existing.length > 0) {
        return res.status(400).json({ message: "Usuário já existe" });
      }
      const hashed = await hashPassword(password);
      const [newUser] = await db.insert(users).values({
        username,
        password: hashed,
        role: role || "user",
      }).returning({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      });
      res.json(newUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { password, role } = req.body;
      const updates: any = {};
      if (password) updates.password = await hashPassword(password);
      if (role) updates.role = role;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nenhuma alteração fornecida" });
      }
      const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      });
      if (!updated) return res.status(404).json({ message: "Usuário não encontrado" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (req.user!.id === id) {
        return res.status(400).json({ message: "Não é possível excluir seu próprio usuário" });
      }
      await sessionManager.removeAllSessionsForUser(id);
      await db.delete(users).where(eq(users.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
