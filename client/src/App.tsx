import { useState, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QRCodeScreen } from "@/components/qr-code-screen";
import { Dashboard } from "@/pages/dashboard";
import { LoginPage } from "@/pages/login";
import { AdminPanel } from "@/pages/admin";
import { useWebSocket } from "@/hooks/use-websocket";
import { Loader2 } from "lucide-react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

function AppContent() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((user) => {
        if (user) setAuthUser(user);
        setAuthLoading(false);
      })
      .catch(() => setAuthLoading(false));
  }, []);

  const handleLogin = (user: AuthUser) => {
    setAuthUser(user);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    setAuthUser(null);
    setShowAdmin(false);
    queryClient.clear();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (showAdmin && authUser.role === "admin") {
    return <AdminPanel onBack={() => setShowAdmin(false)} currentUserId={authUser.id} />;
  }

  return (
    <AuthenticatedApp
      user={authUser}
      onLogout={handleLogout}
      onShowAdmin={authUser.role === "admin" ? () => setShowAdmin(true) : undefined}
    />
  );
}

function AuthenticatedApp({
  user,
  onLogout,
  onShowAdmin,
}: {
  user: AuthUser;
  onLogout: () => void;
  onShowAdmin?: () => void;
}) {
  const {
    status,
    qrCode,
    transferProgress,
    setTransferProgress,
    lastError,
    clearError,
    sessions,
    queueStatus,
    sessionQRCodes,
  } = useWebSocket(user.id);

  const isConnected = status === "connected";

  return (
    <>
      {isConnected ? (
        <Dashboard
          onDisconnect={() => {}}
          transferProgress={transferProgress}
          onClearProgress={() => setTransferProgress(null)}
          lastError={lastError}
          clearError={clearError}
          sessions={sessions}
          queueStatus={queueStatus}
          sessionQRCodes={sessionQRCodes}
          user={user}
          onLogout={onLogout}
          onShowAdmin={onShowAdmin}
        />
      ) : (
        <QRCodeScreen status={status} qrCode={qrCode} user={user} onLogout={onLogout} onShowAdmin={onShowAdmin} />
      )}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
