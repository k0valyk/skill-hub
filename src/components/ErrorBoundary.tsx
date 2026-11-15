import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Skill Hub UI error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <TriangleAlert size={32} style={{ color: "var(--danger)" }} />
          <div>
            <h1 className="text-[16px] font-semibold">Інтерфейс зупинився</h1>
            <p className="mt-1 max-w-md text-[12px] leading-relaxed text-[var(--muted)]">
              {this.state.error}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Перезавантажити
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
