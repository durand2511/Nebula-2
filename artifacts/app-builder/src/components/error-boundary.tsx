import { Component, type ReactNode, type ErrorInfo } from "react";

/**
 * App-wide error boundary: a render/runtime error in any component shows a friendly recovery screen
 * (with the error text + which component failed, so problems are diagnosable) instead of a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, where: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { error, where: "" };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack pinpoints the failing component (top few frames).
    const where = (info?.componentStack || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6).join("\n");
    this.setState({ where });
    // eslint-disable-next-line no-console
    console.error("[Nebula] app error:", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f7f4ee", color: "#241f1a", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif" }}>
          <div style={{ maxWidth: 440, textAlign: "center", background: "#fff", border: "1px solid #e6e2d8", borderRadius: 20, padding: "32px 28px", boxShadow: "0 12px 40px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize: 34 }}>🌙</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "10px 0 6px" }}>Er ging iets mis</h1>
            <p style={{ color: "#6b6456", lineHeight: 1.6, margin: 0 }}>Nebula liep tegen een probleem aan. Laad de pagina opnieuw om verder te gaan — je werk is bewaard.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 18, width: "100%", height: 46, borderRadius: 12, border: 0, background: "#241f1a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
            >
              Nebula opnieuw laden
            </button>
            <details style={{ marginTop: 14, textAlign: "left" }}>
              <summary style={{ fontSize: 12, color: "#8b8577", cursor: "pointer" }}>Technische details</summary>
              <pre style={{ marginTop: 8, fontSize: 11, color: "#8b8577", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(this.state.error?.message || this.state.error)}{this.state.where ? "\n\n" + this.state.where : ""}</pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
