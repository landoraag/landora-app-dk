import { Component } from "react";
import { isChunkError, reloadForNewVersion } from "../lib/lazyPage";

// Se algo quebrar ao mostrar uma tela, aparece um aviso com botão em vez de uma tela preta.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Erro na tela:", error, info?.componentStack);
    if (isChunkError(error)) reloadForNewVersion();
  }

  componentDidUpdate(prev) {
    // Trocou de aba: tenta de novo.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const update = isChunkError(this.state.error);
    return (
      <div className="error-screen">
        <div className="error-card">
          <h3>{update ? "Saiu uma versão nova do Landora" : "Algo deu errado nesta tela"}</h3>
          <p className="muted">
            {update
              ? "Atualize para continuar usando."
              : "Recarregue a página. Se continuar acontecendo, mande um print desta tela."}
          </p>
          {!update && <code className="error-msg">{String(this.state.error?.message || this.state.error).slice(0, 200)}</code>}
          <button className="btn btn-gradient" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
