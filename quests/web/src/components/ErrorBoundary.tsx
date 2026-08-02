import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { fallback?: ReactNode; children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="container-narrow text-sm text-rose-400">
          <p>Something went wrong rendering this view.</p>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-500">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
