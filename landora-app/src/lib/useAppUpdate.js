import { useCallback, useEffect, useState } from "react";

/* global __APP_VERSION__ */
const CURRENT = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";
const CHECK_EVERY_MS = 2 * 60 * 1000;

// Descobre se saiu uma versão nova do app (depois de um deploy) enquanto ele estava aberto.
// canAutoReload = pode recarregar sozinho quando o app estiver em segundo plano
// (falso durante uma call, para não derrubar ninguém).
export function useAppUpdate({ canAutoReload }) {
  const [available, setAvailable] = useState(false);

  const check = useCallback(async () => {
    if (import.meta.env.DEV || !CURRENT) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      if (version && version !== CURRENT) setAvailable(true);
    } catch {
      /* sem internet agora: tenta de novo depois */
    }
  }, []);

  useEffect(() => {
    check();
    const i = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(i);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // Atualiza sozinho quando ninguém está olhando (app minimizado / outra aba) e não há call.
  useEffect(() => {
    if (!available || !canAutoReload) return undefined;
    const maybeReload = () => {
      if (document.visibilityState === "hidden") window.location.reload();
    };
    maybeReload();
    document.addEventListener("visibilitychange", maybeReload);
    return () => document.removeEventListener("visibilitychange", maybeReload);
  }, [available, canAutoReload]);

  return { available, reload: () => window.location.reload() };
}
