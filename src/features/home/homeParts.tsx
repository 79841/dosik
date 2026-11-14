import { RotateCw } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { toastError } from "../../shared/lib/toastStore";
import { SKELETON_DELAY_MS } from "../library/libraryParts";
import { useLibraryStore } from "../library/libraryStore";
import { FRAME_BUTTON } from "./homeStyles";

/**
 * True once the library has been loading for `SKELETON_DELAY_MS` (#178) —
 * below that a read is local-disk fast and placeholders would only flash.
 */
export const useSlow = (loading: boolean): boolean => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return loading && slow;
};

/** a quiet panel for an empty or failed view (D20) — no border, the frame tone */
export const HomeNotice = ({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="rounded-lg bg-frame px-6 py-10 text-center">
    <p className="m-0 text-[13px] font-semibold text-ink">{title}</p>
    {children ? <p className="m-0 mt-1 text-[12px] text-muted">{children}</p> : null}
    {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
  </div>
);

/**
 * The library could not be read and nothing was listed before (#178) — not
 * an empty library. Every Home view shows the same box (D20).
 */
export const LoadFailed = () => {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    void useLibraryStore
      .getState()
      .refresh()
      .catch(toastError)
      .finally(() => setRetrying(false));
  };
  return (
    <HomeNotice
      title="Couldn't load your projects"
      action={
        <button type="button" onClick={retry} disabled={retrying} className={FRAME_BUTTON}>
          <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />
          Try again
        </button>
      }
    >
      Dosik couldn't read its library folder. Try again, or open a .dosik.json file from the
      sidebar.
    </HomeNotice>
  );
};

/** where a picture would be, for a diagram whose file could not be read (D20) */
export const NoPreview = () => (
  <div className="flex h-full w-full items-center justify-center text-[11px] text-muted">
    No preview
  </div>
);

/**
 * A path as text (#231 D10) — "Payments / Checkout", in the breadcrumb's
 * colours: the "/" between the names is `dash` and not read out. In a flex
 * row (the Continue chip) each name and "/" is an item — the row's gap spaces
 * them and a name gives way with an ellipsis; inline (a Recent card's meta)
 * it is one run of text, " / " spaced, that its box cuts short.
 */
export const PathText = ({ names }: { names: readonly string[] }) => (
  <>
    {names.map((name, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: two folders on a path may share a name; the place is the identity
      <Fragment key={i}>
        {i > 0 ? (
          <span aria-hidden="true" className="flex-none text-dash">
            {" / "}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{name}</span>
      </Fragment>
    ))}
  </>
);

/** the canvas's dot grid on a preview well, 16px apart (D9) */
export const DOT_GRID_16 =
  "bg-[radial-gradient(var(--dot)_1px,transparent_1.2px)] bg-[length:16px_16px]";

/** the listing as a view needs it: the folders, and whether it failed with nothing to show */
export const useListing = () => {
  const folders = useLibraryStore((s) => s.folders);
  const readFailed = useLibraryStore((s) => s.readFailed);
  const slow = useSlow(folders === null);
  return { folders, failed: readFailed && (folders?.length ?? 0) === 0, slow };
};
