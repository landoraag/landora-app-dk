import { useCall } from "../context/CallContext";
import { useAppUpdate } from "../lib/useAppUpdate";

// Aviso "saiu versão nova". Fora de call, o app também se atualiza sozinho quando fica em segundo plano.
export default function UpdateBanner() {
  const { status } = useCall();
  const inCall = status !== "idle";
  const { available, reload } = useAppUpdate({ canAutoReload: !inCall });
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>✨ Saiu uma versão nova do Landora.</span>
      <button type="button" onClick={reload}>
        {inCall ? "Atualizar (sai da call)" : "Atualizar agora"}
      </button>
    </div>
  );
}
