import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error) {
    console.error("Error caught by boundary:", error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#1a1a1a] text-white">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">⚠️</div>
            <div className="text-2xl font-bold mb-4">Something went wrong</div>
            <div className="text-gray-400 mb-6">{this.state.error?.message}</div>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-500 rounded font-bold hover:bg-blue-600"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
