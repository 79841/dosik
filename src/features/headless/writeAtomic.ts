import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

/**
 * Writes beside the target and renames over it, so a process reaped mid-write
 * (an MCP client shutting its server down) never leaves the user's file
 * truncated (#151). Unlike `library.rs` it does not fsync first — the
 * risk being closed is a killed process, not a power cut.
 *
 * Two things a plain overwrite gave for free and a rename does not, kept on
 * purpose (#151, rounds 2–3):
 * - **the mode** — the rename puts a new inode in place, so a `chmod 600` file
 *   would come back 644. It is copied over; the app's own Save keeps it too.
 * - **a read-only lock** — a rename needs only the directory to be writable,
 *   so a file the user locked with `chmod 444` would be replaced anyway. It is
 *   refused first, the way an in-place write would have been.
 *
 * The tmp name is the pid alone: writes inside one run are sequential, and two
 * runs have two pids.
 */
export const writeAtomic = (path: string, data: string | Buffer): void => {
  const tmp = `${path}.${process.pid}.tmp`;
  let mode: number | undefined;
  if (existsSync(path)) {
    accessSync(path, constants.W_OK);
    mode = statSync(path).mode & 0o777;
  }
  try {
    writeFileSync(tmp, data);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    // the caller named `path`; a message about a `.tmp` it never asked for
    // would only confuse whoever reads it
    if (error instanceof Error) error.message = error.message.split(tmp).join(path);
    throw error;
  }
};
