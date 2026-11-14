import { vi } from "vitest";

export const getCurrentWindow = vi.fn(() => ({
  onCloseRequested: vi.fn(async (): Promise<() => void> => () => {}),
  onResized: vi.fn(async (): Promise<() => void> => () => {}),
  isFullscreen: vi.fn(async (): Promise<boolean> => false),
  close: vi.fn(async (): Promise<void> => {}),
  minimize: vi.fn(async (): Promise<void> => {}),
  toggleMaximize: vi.fn(async (): Promise<void> => {}),
}));
