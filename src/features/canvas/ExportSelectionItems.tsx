import { TEXT_MUTED } from "../../shared/lib/palette";
import { useChatStore } from "../ai/chatStore";
import {
  copyMarkdown,
  copyPng,
  copySvg,
  exportMarkdown,
  exportPng,
  exportSvg,
  runExport,
} from "../export/exportActions";

/**
 * The "export what is picked" group, shared by both right-click menus (#139).
 * Its first item is not an export: it opens the Mermaid preview, which shows
 * the same picked piece (#194).
 *
 * Shapes and edges both reach it: a free arrow is an edge holding two anchors,
 * and selecting it alone is a selection worth exporting — the rule
 * `selection.ts` was written for. Leaving it out of the edge menu would drop
 * a capability #48 shipped.
 *
 * Keyboard: its items are the menu's own — the menu around it takes the focus
 * and walks them with the rest (`useMenuKeys`, #219). On macOS
 * there is no context-menu key, so the canvas shortcut is the way in without a
 * pointer (`canvasKeymap`).
 */
/**
 * Among the exports, copying is first: exporting is usually on the way to
 * pasting (#143). Markdown leads both groups, as in the toolbar — the one
 * export that must always be there (#192). The preview item above both groups
 * is not an export (#194).
 */
const COPY: [string, () => Promise<string | null>][] = [
  ["Copy as Markdown", () => copyMarkdown(true)],
  ["Copy image", () => copyPng(true)],
  ["Copy as SVG", () => copySvg(true)],
];

const SAVE: [string, () => Promise<string | null>][] = [
  // Markdown filters — only the picked shapes and the edges between them (#192)
  ["Markdown (.md)", () => exportMarkdown(true)],
  // "cropped": the image is the selection's bounding box, so anything falling
  // inside it is captured too (#48)
  ["PNG image (cropped)", () => exportPng(true)],
  ["SVG image (cropped)", () => exportSvg(true)],
];

const ITEM =
  "w-full rounded-md px-3 py-1.5 text-left text-[12px] font-medium text-muted-strong transition-colors hover:bg-hover focus-visible:bg-hover";

const Heading = ({ children }: { children: React.ReactNode }) => (
  <p
    className={`px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide ${TEXT_MUTED}`}
  >
    {children}
  </p>
);

const Item = ({
  label,
  task,
  onDone,
}: {
  label: string;
  task: () => Promise<string | null>;
  onDone: () => void;
}) => (
  <button
    type="button"
    role="menuitem"
    // the heading is not read with each item by every screen reader, and the
    // toolbar's whole-document items are worded the same
    aria-label={`${label}, selection only`}
    onClick={() => {
      onDone();
      void runExport(task);
    }}
    className={ITEM}
  >
    {label}
  </button>
);

// a fragment, not a group: each item carries "selection only" in its own
// accessible name, which is what had to be distinct from the toolbar's
// whole-document exports
export const ExportSelectionItems = ({ onDone }: { onDone: () => void }) => (
  <>
    {/* not an export: it opens the right panel on the Mermaid preview, which
          already shows just what is picked — the selection stays (#194) */}
    <button
      type="button"
      role="menuitem"
      aria-label="Preview in Mermaid, selection only"
      onClick={() => {
        onDone();
        useChatStore.getState().setMermaidMode("preview");
        useChatStore.getState().showView("mermaid");
      }}
      className={ITEM}
    >
      Preview in Mermaid
    </button>
    <div className="my-1 h-px bg-line" />
    <Heading>Copy selection</Heading>
    {COPY.map(([label, task]) => (
      <Item key={label} label={label} task={task} onDone={onDone} />
    ))}
    <div className="my-1 h-px bg-line" />
    <Heading>Save selection as</Heading>
    {SAVE.map(([label, task]) => (
      <Item key={label} label={label} task={task} onDone={onDone} />
    ))}
  </>
);
