import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeftRight,
  PartyPopper,
  Timer,
  Pause,
  Play,
  Square,
} from "lucide-react";
import type { TransferProgress as TransferProgressType } from "@shared/schema";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TransferProgressProps {
  progress: TransferProgressType;
  onClose: () => void;
}

export function TransferProgressView({
  progress,
  onClose,
}: TransferProgressProps) {
  const { toast } = useToast();
  const percentage =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const isComplete = progress.status === "completed" || progress.status === "error" || progress.status === "stopped";
  const isCooldown = progress.status === "cooldown";
  const isPaused = progress.status === "paused";
  const isRunning = progress.status === "in_progress" || isCooldown;

  const handlePause = async () => {
    try {
      await apiRequest("POST", "/api/whatsapp/transfer/pause");
    } catch {
      toast({ title: "Erro", description: "Falha ao pausar", variant: "destructive" });
    }
  };

  const handleResume = async () => {
    try {
      await apiRequest("POST", "/api/whatsapp/transfer/resume");
    } catch {
      toast({ title: "Erro", description: "Falha ao retomar", variant: "destructive" });
    }
  };

  const handleStop = async () => {
    try {
      await apiRequest("POST", "/api/whatsapp/transfer/stop");
    } catch {
      toast({ title: "Erro", description: "Falha ao parar", variant: "destructive" });
    }
  };

  const statusTitle = () => {
    if (progress.status === "completed") return "Transferência concluída";
    if (progress.status === "stopped") return "Transferência interrompida";
    if (progress.status === "error") return "Erro na transferência";
    if (isPaused) return "Transferência pausada";
    if (isCooldown) return "Aguardando cooldown...";
    return "Transferindo membros...";
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-4"
    >
      <div className="text-center">
        {isComplete ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200 }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-3"
          >
            {progress.status === "stopped" ? (
              <Square className="w-7 h-7 text-orange-500" />
            ) : (
              <PartyPopper className="w-7 h-7 text-primary" />
            )}
          </motion.div>
        ) : isPaused ? (
          <motion.div
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-orange-500/10 mb-3"
          >
            <Pause className="w-7 h-7 text-orange-500" />
          </motion.div>
        ) : isCooldown ? (
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-yellow-500/10 mb-3"
          >
            <Timer className="w-7 h-7 text-yellow-600 dark:text-yellow-400" />
          </motion.div>
        ) : (
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-3">
            <ArrowLeftRight className="w-7 h-7 text-primary" />
          </div>
        )}
        <h3 className="font-semibold text-foreground text-lg" data-testid="text-transfer-title">
          {statusTitle()}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {progress.completed} de {progress.total} membros processados
        </p>
        {isCooldown && progress.cooldownSeconds && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 px-4 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 inline-block"
          >
            <p className="text-sm text-yellow-700 dark:text-yellow-300 font-medium" data-testid="text-cooldown-timer">
              WhatsApp bloqueou temporariamente - retomando em {progress.cooldownSeconds}s
            </p>
            <p className="text-xs text-yellow-600/70 dark:text-yellow-400/70 mt-0.5">
              Pausa necessária para evitar bloqueio permanente
            </p>
          </motion.div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Progresso</span>
          <span className="text-xs font-medium text-foreground" data-testid="text-percentage">
            {percentage}%
          </span>
        </div>
        <Progress value={percentage} className="h-2" data-testid="progress-bar" />
      </div>

      <div className="flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium" data-testid="text-succeeded">
            {progress.succeeded}
          </span>
          <span className="text-xs text-muted-foreground">sucesso</span>
        </div>
        <div className="flex items-center gap-1.5">
          <XCircle className="w-4 h-4 text-destructive" />
          <span className="text-sm font-medium" data-testid="text-failed">
            {progress.failed}
          </span>
          <span className="text-xs text-muted-foreground">falhas</span>
        </div>
      </div>

      {!isComplete && (
        <div className="flex items-center justify-center gap-3">
          {isPaused ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResume}
              data-testid="button-resume"
              className="gap-2"
            >
              <Play className="w-4 h-4" />
              Retomar
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePause}
              data-testid="button-pause"
              className="gap-2"
            >
              <Pause className="w-4 h-4" />
              Pausar
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            data-testid="button-stop"
            className="gap-2"
          >
            <Square className="w-4 h-4" />
            Parar
          </Button>
        </div>
      )}

      {progress.results.length > 0 && (
        <ScrollArea className="h-[200px]">
          <div className="space-y-1 pr-3">
            {progress.results.map((result, index) => (
              <motion.div
                key={result.participantId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50"
              >
                {result.success ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-destructive shrink-0" />
                )}
                <span className="text-sm text-foreground truncate">
                  +{result.participantId.split("@")[0]}
                </span>
                {result.error && (
                  <span className="text-xs text-muted-foreground truncate ml-auto">
                    {result.error}
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </ScrollArea>
      )}

      {!isComplete && !isCooldown && !isPaused && (
        <div className="flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      )}

      {isComplete && (
        <Button onClick={onClose} className="w-full" data-testid="button-close-progress">
          Voltar ao painel
        </Button>
      )}
    </motion.div>
  );
}
