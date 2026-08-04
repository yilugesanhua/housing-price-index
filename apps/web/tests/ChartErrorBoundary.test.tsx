// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartErrorBoundary } from "../src/ChartErrorBoundary";

function BrokenChart(): never {
  throw new Error("chunk failed");
}

describe("ChartErrorBoundary", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps a retry action visible when a chart component fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const retry = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    act(() => root.render(<ChartErrorBoundary title="历史走势图" onRetry={retry}><BrokenChart /></ChartErrorBoundary>));
    expect(container.textContent).toContain("历史走势图暂时无法显示");
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("重新加载页面");
    act(() => button?.click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
