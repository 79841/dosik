import { vi } from "vitest";

export const listen = vi.fn(async (): Promise<() => void> => () => {});
export const emit = vi.fn(async (): Promise<void> => {});
