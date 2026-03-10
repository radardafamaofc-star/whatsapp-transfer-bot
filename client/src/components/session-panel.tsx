import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Plus,
  Trash2,
  Smartphone,
  Loader2,
  Wifi,
  WifiOff,
  QrCode,
  Clock,
} from "lucide-react";
import type { SessionInfo } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface SessionPanelProps {
  sessions: SessionInfo[];
  sessionQRCodes: Record<string, string>;
  onSessionsChange: () => void;
}

export function SessionPanel({ sessions, sessionQRCodes, onSessionsChange }: SessionPanelProps) {
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddSession = async () => {
    setIsAdding(true);
    try {
      await apiRequest("POST", "/api/sessions/add");
      onSessionsChange();
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Falha ao adicionar sessão",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveSession = async (sessionId: string) => {
    try {
      await apiRequest("POST", `/api/sessions/${sessionId}/remove`);
      onSessionsChange();
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Falha ao remover sessão",
        variant: "destructive",
      });
    }
  };

  const statusColor = (s: SessionInfo) => {
    if (s.status === "connected") return "bg-green-500";
    if (s.status === "connecting" || s.status === "qr_code") return "bg-yellow-500";
    return "bg-red-500";
  };

  const statusLabel = (s: SessionInfo) => {
    if (s.status === "connected") return "Conectado";
    if (s.status === "qr_code") return "Aguardando QR";
    if (s.status === "connecting") return "Conectando";
    if (s.status === "auth_failure") return "Falha";
    return "Desconectado";
  };

  const now = Date.now();

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground text-sm" data-testid="text-sessions-title">
            Contas conectadas
          </h3>
          <Badge variant="secondary" data-testid="badge-session-count">
            {sessions.filter((s) => s.status === "connected").length}/{sessions.length}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAddSession}
          disabled={isAdding}
          data-testid="button-add-session"
        >
          {isAdding ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-1.5" />
          )}
          Adicionar conta
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          Nenhuma conta conectada. Clique em "Adicionar conta" para começar.
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {sessions.map((session) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="border rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${statusColor(session)}`} />
                    <span className="text-sm font-medium text-foreground" data-testid={`text-session-id-${session.id}`}>
                      {session.phoneNumber ? `+${session.phoneNumber}` : session.id}
                    </span>
                    <Badge
                      variant={session.status === "connected" ? "default" : "secondary"}
                      className="text-xs"
                      data-testid={`badge-session-status-${session.id}`}
                    >
                      {statusLabel(session)}
                    </Badge>
                    {session.isBusy && (
                      <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300">
                        Ocupado
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveSession(session.id)}
                    className="text-destructive hover:text-destructive h-7 w-7 p-0"
                    data-testid={`button-remove-session-${session.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                {session.status === "qr_code" && sessionQRCodes[session.id] && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="flex flex-col items-center gap-2 pt-2 border-t"
                  >
                    <div className="flex items-center gap-1.5 text-primary text-xs">
                      <QrCode className="w-4 h-4" />
                      <span>Escaneie o QR Code</span>
                    </div>
                    <div className="bg-white p-2 rounded-lg">
                      <img
                        src={sessionQRCodes[session.id]}
                        alt={`QR Code ${session.id}`}
                        className="w-40 h-40 sm:w-48 sm:h-48"
                        data-testid={`img-qr-${session.id}`}
                      />
                    </div>
                  </motion.div>
                )}

                {session.status === "connected" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t">
                    <div className="flex items-center gap-1" data-testid={`text-adds-${session.id}`}>
                      <Wifi className="w-3 h-3 shrink-0" />
                      <span>{session.addsThisHour}/{session.maxAddsPerHour} adds/h</span>
                    </div>
                    <Progress
                      value={(session.addsThisHour / session.maxAddsPerHour) * 100}
                      className="h-1.5 flex-1 min-w-16 max-w-24"
                    />
                    <span className="hidden sm:inline">Total: {session.totalAdds} adds, {session.totalInvites} convites</span>
                    <span className="sm:hidden">{session.totalAdds}A / {session.totalInvites}C</span>
                    {session.cooldownUntil && session.cooldownUntil > now && (
                      <div className="flex items-center gap-1 text-yellow-600">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>Cooldown {Math.ceil((session.cooldownUntil - now) / 60000)}min</span>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
