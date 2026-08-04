import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ChartErrorBoundaryProps {
  children: ReactNode;
  title: string;
  onRetry: () => void;
}

interface ChartErrorBoundaryState {
  failed: boolean;
}

export class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("chart component failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="chart-empty chart-error-boundary" role="alert">
      <AlertCircle size={26} aria-hidden="true" />
      <strong>{this.props.title}暂时无法显示</strong>
      <span>页面其他数据仍可查看。请重新加载后再试。</span>
      <button type="button" className="outline-button" onClick={this.props.onRetry}><RefreshCw size={15} aria-hidden="true" />重新加载页面</button>
    </div>;
  }
}
