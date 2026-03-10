import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Smartphone, Wifi, WifiOff, QrCode, RefreshCw } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import type { WhatsAppStatus } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface QRCodeScreenProps {
  status: WhatsAppStatus;
  qrCode: string | null;
  user?: { id: number; username: string; role: string };
  onLogout?: () => void;
  onShowAdmin?: () => void;
}

export function QRCodeScreen({ status, qrCode, user, onLogout, onShowAdmin }: QRCodeScreenProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await apiRequest("POST", "/api/whatsapp/connect");
    } catch (err) {
      console.error("Failed to connect:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiRequest("POST", "/api/whatsapp/disconnect");
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4"
          >
            <SiWhatsapp className="w-8 h-8 text-primary-foreground" />
          </motion.div>
          <h1
            className="text-2xl font-bold text-foreground mb-2"
            data-testid="text-title"
          >
            WhatsApp Transfer Bot
          </h1>
          <p className="text-muted-foreground text-sm">
            Conecte seu WhatsApp para transferir membros entre grupos
          </p>
        </div>

        <Card className="p-6">
          <AnimatePresence mode="wait">
            {status === "disconnected" && (
              <motion.div
                key="disconnected"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                  <WifiOff className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground mb-1">
                    Desconectado
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Clique para iniciar a conexão com o WhatsApp
                  </p>
                </div>
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="w-full"
                  data-testid="button-connect"
                >
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Smartphone className="w-4 h-4 mr-2" />
                  )}
                  Conectar WhatsApp
                </Button>
              </motion.div>
            )}

            {status === "connecting" && (
              <motion.div
                key="connecting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-4"
              >
                <div className="relative">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Wifi className="w-6 h-6 text-primary" />
                  </div>
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-primary/30"
                    animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground mb-1">
                    Conectando...
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Aguarde enquanto inicializamos a conexão
                  </p>
                </div>
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </motion.div>
            )}

            {status === "qr_code" && (
              <motion.div
                key="qr_code"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="flex items-center gap-2 text-primary">
                  <QrCode className="w-5 h-5" />
                  <p className="font-medium text-sm">Escaneie o QR Code</p>
                </div>

                {qrCode ? (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white p-3 rounded-lg"
                  >
                    <img
                      src={qrCode}
                      alt="QR Code WhatsApp"
                      className="w-56 h-56 sm:w-64 sm:h-64"
                      data-testid="img-qr-code"
                    />
                  </motion.div>
                ) : (
                  <div className="w-56 h-56 sm:w-64 sm:h-64 bg-muted rounded-lg flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                )}

                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Abra o WhatsApp no seu celular
                  </p>
                  <ol className="text-xs text-muted-foreground space-y-1 text-left">
                    <li>1. Toque em <strong>Menu</strong> ou <strong>Configurações</strong></li>
                    <li>2. Toque em <strong>Dispositivos conectados</strong></li>
                    <li>3. Toque em <strong>Conectar um dispositivo</strong></li>
                    <li>4. Aponte o celular para esta tela</li>
                  </ol>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDisconnect}
                  data-testid="button-cancel"
                >
                  Cancelar
                </Button>
              </motion.div>
            )}

            {status === "auth_failure" && (
              <motion.div
                key="auth_failure"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                  <WifiOff className="w-6 h-6 text-destructive" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground mb-1">
                    Falha na autenticação
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Não foi possível autenticar. Tente novamente.
                  </p>
                </div>
                <Button
                  onClick={handleConnect}
                  data-testid="button-retry"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Tentar novamente
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {user && (
          <div className="text-center mt-4">
            <p className="text-xs text-muted-foreground mb-2">
              Logado como <strong>{user.username}</strong>
            </p>
            <div className="flex items-center justify-center gap-2">
              {onShowAdmin && (
                <Button variant="outline" size="sm" onClick={onShowAdmin} data-testid="button-admin-qr">
                  Painel Admin
                </Button>
              )}
              {onLogout && (
                <Button variant="ghost" size="sm" onClick={onLogout} data-testid="button-logout-qr">
                  Sair da conta
                </Button>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          Seus dados estão seguros. A conexão é feita localmente.
        </p>
      </motion.div>
    </div>
  );
}
