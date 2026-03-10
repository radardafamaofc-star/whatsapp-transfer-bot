import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ListOrdered,
  CheckCircle2,
  XCircle,
  Timer,
  TrendingUp,
} from "lucide-react";
import type { QueueStatus as QueueStatusType } from "@shared/schema";
import { motion } from "framer-motion";

interface QueueStatusProps {
  queue: QueueStatusType;
}

export function QueueStatusPanel({ queue }: QueueStatusProps) {
  const percentage =
    queue.totalMembers > 0
      ? Math.round((queue.processed / queue.totalMembers) * 100)
      : 0;

  const successRate =
    queue.processed > 0
      ? Math.round((queue.succeeded / queue.processed) * 100)
      : 0;

  if (queue.totalMembers === 0 && !queue.isRunning) {
    return null;
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <ListOrdered className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-foreground text-sm" data-testid="text-queue-title">
          Status da Fila
        </h3>
        {queue.isRunning && (
          <Badge variant="default" className="text-xs" data-testid="badge-queue-running">
            {queue.isPaused ? "Pausado" : "Processando"}
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Progresso geral</span>
            <span className="font-medium text-foreground" data-testid="text-queue-percentage">{percentage}%</span>
          </div>
          <Progress value={percentage} className="h-2" data-testid="progress-queue" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <motion.div
            className="text-center p-2 rounded-md bg-muted/50"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <p className="text-lg font-bold text-foreground" data-testid="text-queue-total">{queue.totalMembers}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </motion.div>

          <motion.div
            className="text-center p-2 rounded-md bg-green-500/10"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
          >
            <p className="text-lg font-bold text-green-600" data-testid="text-queue-succeeded">{queue.succeeded}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Sucesso
            </p>
          </motion.div>

          <motion.div
            className="text-center p-2 rounded-md bg-destructive/10"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
          >
            <p className="text-lg font-bold text-destructive" data-testid="text-queue-failed">{queue.failed}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <XCircle className="w-3 h-3" /> Falhas
            </p>
          </motion.div>

          <motion.div
            className="text-center p-2 rounded-md bg-muted/50"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
          >
            <p className="text-lg font-bold text-foreground" data-testid="text-queue-remaining">{queue.remaining}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Timer className="w-3 h-3" /> Restantes
            </p>
          </motion.div>
        </div>

        <div className="flex items-center justify-between text-xs pt-2 border-t">
          <div className="flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="w-3 h-3" />
            <span>Taxa de sucesso: <strong className="text-foreground" data-testid="text-success-rate">{successRate}%</strong></span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <span>Adds globais: <strong className="text-foreground" data-testid="text-global-adds">{queue.globalAddsCount}</strong></span>
            <span className="text-xs">/ pausa em {queue.safetyPauseAt}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
