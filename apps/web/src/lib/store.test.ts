import { describe, it, expect, beforeEach } from "vitest";
import { useTrafficStore } from "./store";

describe("useTrafficStore data_source", () => {
  beforeEach(() => {
    useTrafficStore.setState({ dataSource: null });
  });

  it("defaults dataSource to null", () => {
    expect(useTrafficStore.getState().dataSource).toBeNull();
  });

  it("derives dataSource from the WS data_source field", () => {
    useTrafficStore.getState().updateData({
      data_source: { mode: "video", detection: "ready", fallback_active: false },
    });
    expect(useTrafficStore.getState().dataSource).toEqual({
      mode: "video",
      detection: "ready",
      fallback_active: false,
    });
  });

  it("retains the previous dataSource when the field is absent", () => {
    useTrafficStore.setState({
      dataSource: { mode: "video", detection: "ready", fallback_active: false },
    });
    useTrafficStore.getState().updateData({ lanes: {} });
    expect(useTrafficStore.getState().dataSource).toEqual({
      mode: "video",
      detection: "ready",
      fallback_active: false,
    });
  });
});
