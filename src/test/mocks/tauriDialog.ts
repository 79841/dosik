import { vi } from "vitest";

export const open = vi.fn(async (): Promise<string | null> => null);
export const save = vi.fn(async (): Promise<string | null> => null);
export const ask = vi.fn(async (): Promise<boolean> => false);
