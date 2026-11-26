import { ArrowRight, Ban, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { matchUmlRelation, UML_RELATION_STYLE, UML_RELATIONS } from "../../shared/lib/classShape";
import { useCommitDrafts } from "../../shared/lib/commitDrafts";
import {
  DEFAULT_EDGE_WIDTH,
  effectiveMarkerEnd,
  effectiveMarkerStart,
} from "../../shared/lib/edgeUtils";
import { ERD_RELATION_STYLE, ERD_RELATIONS, matchErdRelation } from "../../shared/lib/entityShape";
import { ICON_IDS, ICON_LABELS, isIconId } from "../../shared/lib/iconIds";
import { MAX_BADGE, MAX_DESCRIPTION, takesBadge, takesDecor } from "../../shared/lib/nodeDecor";
import { IconGlyph } from "../../shared/lib/icons";
import {
  ACCENT_SOFT,
  ACCENT_SURFACE,
  DEFAULT_NODE_SIZE,
  FOCUS_FIELD,
  FOCUS_RING,
  PALETTE_COLORS,
  SHAPE_KINDS,
  SHAPE_LABELS,
  swatchStyle,
  TEXT_MUTED,
  TEXT_MUTED_ON_FILL,
} from "../../shared/lib/palette";
import { visibleDestroyY } from "../../shared/lib/store/opValidation";
import type {
  EdgePathStyle,
  EdgeVariant,
  FragmentKind,
  MarkerShape,
  MarkerSize,
  PaletteColor,
  ShapeKind,
} from "../../shared/lib/types";
import {
  FRAGMENT_KINDS,
  MAX_FRAGMENT_BRANCHES,
  MIN_FRAGMENT_BRANCHES,
} from "../../shared/lib/types";
import { PREVIEW_COLOR, ShapePreview } from "../palette/ShapePreview";
import type { SelectionEditing } from "../inspector/useSelectionEditing";
import { PLAIN_TEXT } from "../../shared/ui/plainText";

/**
 * What the edit bar's popovers hold (#159) — the old inspector's sections,
 * one component each, editing the whole selection through
 * `useSelectionEditing`. The fields keep the inspector's rules: numbers commit
 * on blur, free text survives an agent editing the same node (`useExternalDraft`).
 */

const FIELD = `w-full rounded-md bg-frame px-3 py-1.5 text-[12.5px] text-ink ${FOCUS_FIELD}`;
const SELECT = `w-full rounded-md bg-frame px-2 py-1.5 text-[12.5px] text-ink ${FOCUS_RING}`;
const SOFT_BUTTON =
  "rounded-md bg-frame px-2 py-1.5 text-[12px] text-muted-strong hover:bg-selected disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-frame";
const HINT = `text-[11px] leading-snug ${TEXT_MUTED}`;

/**
 * Numeric field that only writes to the store on blur/Enter.
 *
 * Writing per keystroke fights the controlled value: an intermediate "1" of
 * "120" gets clamped to the line, the field rewrites itself to the clamped
 * number, and the next keystroke appends to *that*. Holding a local draft
 * while focused also keeps one edit to one undo frame.
 */
export const CommitOnBlurNumber = ({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (next: number) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  /** the draft Save wrote while the field stayed open — the blur after it has nothing new */
  const written = useRef<string | null>(null);
  const commit = (): void => {
    if (draft !== null && draft !== "" && draft !== written.current) onCommit(Number(draft));
    written.current = null;
    setDraft(null);
  };
  // Save (⌘S) takes the number typed so far; the field keeps it (#219)
  useCommitDrafts(draft !== null, () => {
    if (draft === null || draft === "" || draft === written.current) return;
    onCommit(Number(draft));
    written.current = draft;
  });
  return (
    <input
      type="number"
      className={`w-16 rounded-md bg-frame px-2 py-1 text-[13px] text-ink ${FOCUS_FIELD}`}
      value={draft ?? Math.round(value)}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          written.current = null;
          // Escape here cancels the typing, not the popover: closing would
          // blur the field and commit the very draft being thrown away
          e.stopPropagation();
        }
      }}
    />
  );
};

export const SectionLabel = ({ children }: { children: string }) => (
  <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${TEXT_MUTED}`}>
    {children}
  </p>
);

export const SegmentedRow = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="flex flex-1 gap-1">
    {options.map((opt) => (
      <button
        key={opt.id}
        type="button"
        onClick={() => onChange(opt.id)}
        className={`flex-1 rounded-md px-1 py-1.5 text-[11.5px] font-medium transition-colors ${
          value === opt.id
            ? ACCENT_SURFACE
            : `bg-frame ${TEXT_MUTED} hover:bg-selected hover:text-muted-strong`
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export const MARKER_OPTIONS: { id: MarkerShape; label: string }[] = [
  { id: "none", label: "None" },
  { id: "arrow", label: "Arrow ▶" },
  { id: "open", label: "Open ›" },
  { id: "circle", label: "Circle ●" },
  { id: "diamond", label: "Diamond ◆" },
  { id: "bar", label: "Bar |" },
  { id: "many", label: "Crow's foot" },
  { id: "triangle", label: "Triangle △" },
  { id: "diamond-open", label: "Diamond ◇" },
  { id: "one", label: "ERD one ‖" },
  { id: "zero-one", label: "ERD zero or one" },
  { id: "one-many", label: "ERD one or many" },
  { id: "zero-many", label: "ERD zero or many" },
];

export const ColorSwatches = ({
  selected,
  withDefault,
  onPick,
}: {
  selected: PaletteColor | undefined;
  withDefault?: boolean;
  onPick: (color: PaletteColor | undefined) => void;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {withDefault ? (
      <button
        type="button"
        title="Default"
        onClick={() => onPick(undefined)}
        className="h-6 w-6 rounded-full transition-transform hover:scale-110"
        style={swatchStyle(undefined, selected === undefined)}
      />
    ) : null}
    {PALETTE_COLORS.map((color) => (
      <button
        key={color}
        type="button"
        title={color}
        onClick={() => onPick(color)}
        className="h-6 w-6 rounded-full transition-transform hover:scale-110"
        style={swatchStyle(color, selected === color)}
      />
    ))}
  </div>
);

/**
 * Members are edited as free text, one per line — every UML tool surveyed makes
 * a one-line signature the primary entry path. Commits on blur so a half-typed
 * line never reaches the store (and never floods undo).
 */
/**
 * Text that follows the store while the field is idle and stops following while
 * the user is in it. The agent and the user edit the same diagram at once, so an
 * agent edit landing mid-typing must not wipe what is being typed.
 *
 * Deliberately not done by remounting on a value-derived `key`: that dropped the
 * caret, and gating the key on focus was worse still — the key changed at the
 * moment focus arrived, so the remount threw the focus away and left the gate
 * stuck open (an unmounted element never fires blur).
 */
const useExternalDraft = (
  stored: string,
  shownFor: string,
  /** writes a draft — also used when the field goes away mid-edit */
  commit: (value: string) => void,
) => {
  const [draft, setDraft] = useState(stored);
  const focused = useRef(false);
  const atFocus = useRef(stored);
  const shownForRef = useRef(shownFor);
  const latest = useRef({ draft, commit });
  latest.current = { draft, commit };

  // The field can vanish while focused — an agent's edit took its section
  // away in the same render — and an unmounted field never blurs. Whatever was
  // typed is written on the way out instead of being dropped (#159).
  useEffect(
    () => () => {
      const { draft: last, commit: write } = latest.current;
      if (focused.current && last !== atFocus.current) write(last);
    },
    [],
  );

  useEffect(() => {
    // The field now belongs to a different node — reset even while focused. The
    // selection can move without this input losing focus (an agent op, or undo),
    // and the leftover draft would then be committed onto the *new* node.
    if (shownForRef.current !== shownFor) {
      shownForRef.current = shownFor;
      atFocus.current = stored;
      setDraft(stored);
      return;
    }
    if (!focused.current) setDraft(stored);
  }, [stored, shownFor]);

  // Save (⌘S) takes what is typed so far, and the field goes on (#219): what was written becomes the text "at focus", so the blur after it
  // writes only what changed since
  useCommitDrafts(true, () => {
    const { draft: typed, commit: write } = latest.current;
    if (!focused.current || typed === atFocus.current) return;
    write(typed);
    atFocus.current = typed;
  });

  return {
    draft,
    setDraft,
    onFocus: () => {
      focused.current = true;
      atFocus.current = draft;
    },
    /** Commits only a real edit; an untouched visit re-syncs instead of overwriting. */
    finish: (value: string): boolean => {
      focused.current = false;
      if (value === atFocus.current) {
        setDraft(stored);
        return false;
      }
      return true;
    },
  };
};

export const MemberList = ({
  label,
  nodeId,
  field,
  lines,
  onCommit,
}: {
  label: string;
  nodeId: string;
  field: "attributes" | "methods" | "columns";
  lines: string[] | undefined;
  onCommit: (id: string, patch: Record<string, unknown>) => void;
}) => {
  const { draft, setDraft, onFocus, finish } = useExternalDraft(
    (lines ?? []).join("\n"),
    `${nodeId}/${field}`,
    (value) => onCommit(nodeId, { [field]: value.split("\n") }),
  );
  return (
    <label
      className={`flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide ${TEXT_MUTED}`}
    >
      {label}
      <textarea
        {...PLAIN_TEXT}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={onFocus}
        rows={Math.max(2, draft.split("\n").length + 1)}
        placeholder={
          field === "methods"
            ? "+ save(): void"
            : field === "columns"
              ? "id uuid PK"
              : "+ name: string"
        }
        className={`resize-none rounded-md bg-frame px-2 py-1.5 font-normal text-[12px] normal-case tracking-normal text-ink ${FOCUS_FIELD}`}
        onBlur={(e) => {
          if (finish(e.target.value)) onCommit(nodeId, { [field]: e.target.value.split("\n") });
        }}
      />
    </label>
  );
};

export const StereotypeInput = ({
  nodeId,
  value,
  onCommit,
}: {
  nodeId: string;
  value: string;
  onCommit: (id: string, patch: Record<string, unknown>) => void;
}) => {
  const { draft, setDraft, onFocus, finish } = useExternalDraft(
    value,
    `${nodeId}/stereotype`,
    (next) => onCommit(nodeId, { stereotype: next }),
  );
  return (
    <input
      {...PLAIN_TEXT}
      type="text"
      aria-label="Stereotype"
      placeholder="Stereotype (e.g. interface)"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      className={`w-full rounded-md bg-frame px-2 py-1.5 text-[12px] text-ink ${FOCUS_FIELD}`}
      onBlur={(e) => {
        if (finish(e.target.value)) onCommit(nodeId, { stereotype: e.target.value });
      }}
    />
  );
};

type E = SelectionEditing;
type UpdateNodeData = (id: string, patch: Record<string, unknown>) => void;

// ── shapes ───────────────────────────────────────────────────────────────────

export const NodeColorSection = ({ e }: { e: E }) => (
  <ColorSwatches selected={e.firstNode?.data.color} onPick={(c) => c && e.setNodeColor(c)} />
);

export const ShapeSection = ({ e }: { e: E }) => {
  const node = e.firstNode;
  if (!node) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {/* a native <option> can't hold SVG, so the current shape is shown
          beside the picker — otherwise "Sticky note" is only ever a word */}
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-10 shrink-0 items-center justify-center">
          <ShapePreview shape={node.data.shape} width={28} height={20} />
        </span>
        <select
          aria-label="Shape"
          className={SELECT}
          value={node.data.shape}
          onChange={(ev) => e.setNodeShape(ev.target.value as ShapeKind)}
        >
          {/* a frame is an area: never another shape's next shape (#170 D8) */}
          {SHAPE_KINDS.filter((shape) => shape !== "frame").map((shape) => (
            <option
              key={shape}
              value={shape}
              // a frame has no handles, so a connected node can't become one —
              // disable rather than accept the change and drop it silently
              disabled={
                (shape === "fragment" && !e.canBecomeFragment) ||
                // an image comes from a picture (paste, drop, the palette) — not from a box
                (shape === "image" && node.data.shape !== "image")
              }
            >
              {SHAPE_LABELS[shape]}
            </option>
          ))}
        </select>
      </div>
      {!e.canBecomeFragment ? (
        <p className={HINT}>Fragment frames take no connections — disconnect first</p>
      ) : null}
    </div>
  );
};

/**
 * The label as text. Double-click edits it on the canvas too, but not for every
 * shape: an image draws no label — it is the picture's alt text — so this is
 * the one place to write it (#159 D3).
 */
export const TextSection = ({ e, update }: { e: E; update: UpdateNodeData }) => {
  const node = e.firstNode;
  if (!node) return null;
  const isImage = node.data.shape === "image";
  return (
    <div className="flex flex-col gap-1.5">
      <input
        {...PLAIN_TEXT}
        aria-label={isImage ? "Alt text" : "Label"}
        className={FIELD}
        value={node.data.label}
        placeholder={isImage ? "Describe the picture" : "Enter label"}
        onChange={(ev) => update(node.id, { label: ev.target.value })}
      />
      {isImage ? <p className={HINT}>Not drawn — used in Markdown and Mermaid exports.</p> : null}
      {takesDecor(node.data.shape) ? (
        <DecorText
          nodeId={node.id}
          field="description"
          label="Description"
          value={node.data.description ?? ""}
          onCommit={update}
        />
      ) : null}
      {takesBadge(node.data.shape) ? (
        // a frame takes a badge too — its step number (#210 D23)
        <DecorText
          nodeId={node.id}
          field="badge"
          label="Badge"
          value={node.data.badge ?? ""}
          onCommit={update}
        />
      ) : null}
    </div>
  );
};

/**
 * A box's description or badge (#160). Commits on blur like the member lists:
 * the store trims and caps the text, so writing every keystroke through would
 * eat the space just typed between two words.
 */
const DecorText = ({
  nodeId,
  field,
  label,
  value,
  onCommit,
}: {
  nodeId: string;
  field: "description" | "badge";
  label: string;
  value: string;
  onCommit: (id: string, patch: Record<string, unknown>) => void;
}) => {
  const { draft, setDraft, onFocus, finish } = useExternalDraft(
    value,
    `${nodeId}/${field}`,
    (next) => onCommit(nodeId, { [field]: next }),
  );
  const shared = {
    "aria-label": label,
    value: draft,
    onFocus,
    className: FIELD,
    onBlur: (ev: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (finish(ev.target.value)) onCommit(nodeId, { [field]: ev.target.value });
    },
  };
  return field === "description" ? (
    <textarea
      {...shared}
      {...PLAIN_TEXT}
      rows={Math.max(2, draft.split("\n").length)}
      maxLength={MAX_DESCRIPTION}
      placeholder="Description (smaller, under the label)"
      onChange={(ev) => setDraft(ev.target.value)}
      className={`${FIELD} resize-none`}
    />
  ) : (
    <input
      {...shared}
      {...PLAIN_TEXT}
      type="text"
      maxLength={MAX_BADGE}
      placeholder="Badge (e.g. v2, NEW)"
      onChange={(ev) => setDraft(ev.target.value)}
    />
  );
};

/** one cell of the glyph grid — the left rail's Icons group, picked by a click */
const ICON_CELL = "flex h-8 w-8 items-center justify-center rounded-md transition-colors";
const iconCellState = (picked: boolean) =>
  picked ? `${ACCENT_SOFT} ring-1 ring-primary` : "hover:bg-hover";

/**
 * The icon of an icon node or a box, picked from the same grid of glyphs as the
 * left rail's Icons group (#210) — every glyph in view at once, where a
 * select list hid them behind their names.
 */
export const IconSection = ({ e, update }: { e: E; update: UpdateNodeData }) => {
  const node = e.firstNode;
  if (!node) return null;
  const current = node.data.icon ? String(node.data.icon) : null;
  // the picked cell again is no edit — it must not leave an empty undo step
  const pick = (icon: string) => {
    if (icon !== (current ?? "")) update(node.id, { icon });
  };
  return (
    <fieldset aria-label="Icons" className="grid grid-cols-6 gap-0.5">
      {/* a box may go without; an icon node is its glyph (#160) */}
      {node.data.shape !== "icon" ? (
        <button
          type="button"
          title="None"
          aria-label="None"
          aria-pressed={current === null}
          onClick={() => pick("")}
          className={`${ICON_CELL} ${iconCellState(current === null)}`}
        >
          <Ban size={16} strokeWidth={1.5} aria-hidden="true" className={TEXT_MUTED_ON_FILL} />
        </button>
      ) : null}
      {current !== null && !isIconId(current) ? (
        // an id this build does not know — kept in view so nothing is lost
        <button
          type="button"
          title={`Unknown (${current})`}
          aria-label={`Unknown (${current})`}
          aria-pressed
          className={`${ICON_CELL} ${iconCellState(true)}`}
        >
          <svg width={20} height={20} aria-hidden="true">
            <IconGlyph icon={current} size={20} color={PREVIEW_COLOR.stroke} />
          </svg>
        </button>
      ) : null}
      {ICON_IDS.map((id) => (
        <button
          key={id}
          type="button"
          title={ICON_LABELS[id]}
          aria-label={ICON_LABELS[id]}
          aria-pressed={current === id}
          onClick={() => pick(id)}
          className={`${ICON_CELL} ${iconCellState(current === id)}`}
        >
          <svg width={20} height={20} aria-hidden="true">
            <IconGlyph icon={id} size={20} color={PREVIEW_COLOR.stroke} />
          </svg>
        </button>
      ))}
    </fieldset>
  );
};

export const ClassSection = ({ e, update }: { e: E; update: UpdateNodeData }) => {
  const node = e.soleClass;
  if (!node) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <StereotypeInput nodeId={node.id} value={node.data.stereotype ?? ""} onCommit={update} />
      <label className="flex items-center gap-2 text-[12px] text-muted-strong">
        <input
          type="checkbox"
          aria-label="Abstract"
          className="h-3.5 w-3.5 accent-primary"
          checked={node.data.isAbstract === true}
          onChange={(ev) => update(node.id, { isAbstract: ev.target.checked })}
        />
        Abstract
      </label>
      <MemberList
        label="Attributes"
        nodeId={node.id}
        field="attributes"
        lines={node.data.attributes}
        onCommit={update}
      />
      <MemberList
        label="Methods"
        nodeId={node.id}
        field="methods"
        lines={node.data.methods}
        onCommit={update}
      />
      <p className={HINT}>One member per line. Lead with + - # ~ for visibility.</p>
    </div>
  );
};

export const EntitySection = ({ e, update }: { e: E; update: UpdateNodeData }) => {
  const node = e.soleEntity;
  if (!node) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <MemberList
        label="Columns"
        nodeId={node.id}
        field="columns"
        lines={node.data.columns}
        onCommit={update}
      />
      <p className={HINT}>One column per line: name, type, then PK / FK / UK.</p>
    </div>
  );
};

/** activation bars and the destroy marker — everything on one lifeline's line */
export const LifelineSection = ({ e }: { e: E }) => {
  const node = e.soleLifeline;
  if (!node) return null;
  const height = node.height ?? DEFAULT_NODE_SIZE.lifeline.height;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {(node.data.activations ?? []).map((a, i) => (
          <div
            // spans can repeat while editing — index keeps rows stable
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional edits
            key={i}
            className="flex items-center gap-1.5"
          >
            <CommitOnBlurNumber
              value={a.y0}
              label={`Activation ${i + 1} start`}
              onCommit={(v) => e.setActivationEnd(node.id, i, "y0", v)}
            />
            <ArrowRight size={12} aria-hidden="true" className={TEXT_MUTED} />
            <CommitOnBlurNumber
              value={a.y1}
              label={`Activation ${i + 1} end`}
              onCommit={(v) => e.setActivationEnd(node.id, i, "y1", v)}
            />
            <button
              type="button"
              className={`ml-auto rounded-md px-2 py-1 text-[12px] ${TEXT_MUTED} hover:bg-hover hover:text-danger`}
              onClick={() => e.removeActivation(node.id, i)}
              aria-label={`Remove activation ${i + 1}`}
            >
              <X size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={SOFT_BUTTON}
          onClick={() => e.addActivation(node.id)}
          disabled={!e.canAddActivation}
          title={e.canAddActivation ? undefined : "No room left on this lifeline"}
        >
          + Add activation
        </button>
        <p className={HINT}>y offsets from the lifeline top (header is 0–40)</p>
      </div>
      <div className="border-t border-line pt-3">
        <SectionLabel>Destroy</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="destroy-toggle"
            aria-label="Destroy marker"
            className="h-3.5 w-3.5 accent-primary"
            checked={node.data.destroyY !== undefined}
            onChange={(ev) =>
              e.setDestroyY(
                node.id,
                // three quarters down — a destroy usually ends the object well
                // after it has done some work
                ev.target.checked ? Math.round(height * 0.75) : null,
              )
            }
          />
          <label htmlFor="destroy-toggle" className="text-[13px] text-muted-strong">
            X marker
          </label>
          {node.data.destroyY !== undefined ? (
            <CommitOnBlurNumber
              value={node.data.destroyY}
              label="Destroy y"
              onCommit={(v) => e.setDestroyY(node.id, v)}
            />
          ) : null}
        </div>
        {/* the value is kept when the lifeline is shrunk past it (so growing it
            back restores the marker) — say why nothing is drawn */}
        {node.data.destroyY !== undefined &&
        visibleDestroyY(node.data.destroyY, height) === null ? (
          <p className={`mt-1 ${HINT}`}>
            Outside the line — not drawn until the lifeline covers this y
          </p>
        ) : null}
      </div>
    </div>
  );
};

export const FrameSection = ({ e, update }: { e: E; update: UpdateNodeData }) => {
  const node = e.soleFragment;
  if (!node) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <select
        className={SELECT}
        value={node.data.fragmentKind ?? "alt"}
        aria-label="Fragment kind"
        onChange={(ev) => update(node.id, { fragmentKind: ev.target.value as FragmentKind })}
      >
        {FRAGMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {(node.data.fragmentKind ?? "alt") === "alt" ? (
        <label className="flex items-center gap-2 text-[13px] text-muted-strong">
          Branches
          <select
            className={`rounded-md bg-frame px-2 py-1 text-[13px] text-ink ${FOCUS_RING}`}
            value={node.data.branches ?? MIN_FRAGMENT_BRANCHES}
            aria-label="Branches"
            onChange={(ev) => update(node.id, { branches: Number(ev.target.value) })}
          >
            {Array.from(
              { length: MAX_FRAGMENT_BRANCHES - MIN_FRAGMENT_BRANCHES + 1 },
              (_, i) => MIN_FRAGMENT_BRANCHES + i,
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
};

export const AlignSection = ({ e }: { e: E }) => (
  <div className="flex gap-1.5">
    <button
      type="button"
      className={`flex-1 ${SOFT_BUTTON}`}
      onClick={() => e.alignLifelines("tops")}
    >
      Align tops
    </button>
    <button
      type="button"
      className={`flex-1 ${SOFT_BUTTON}`}
      onClick={() => e.alignLifelines("distribute")}
      disabled={e.selectedLifelines.length < 3}
      title={e.selectedLifelines.length < 3 ? "Select 3 or more lifelines" : undefined}
    >
      Distribute
    </button>
  </div>
);

// ── lines ────────────────────────────────────────────────────────────────────

export const EdgeColorSection = ({ e }: { e: E }) => (
  <ColorSwatches
    selected={e.firstEdge?.data?.color}
    withDefault
    onPick={(color) => e.patchEdges({ color })}
  />
);

export const LabelsSection = ({ e }: { e: E }) => {
  const data = e.firstEdge?.data;
  return (
    <div className="flex flex-col gap-1.5">
      <input
        {...PLAIN_TEXT}
        aria-label="Center label"
        className={FIELD}
        value={data?.label ?? ""}
        placeholder="Center label"
        onChange={(ev) => e.patchEdges({ label: ev.target.value || undefined })}
      />
      <div className="flex gap-1.5">
        <input
          {...PLAIN_TEXT}
          aria-label="Start label"
          className={FIELD}
          value={data?.labelStart ?? ""}
          placeholder="Start (e.g. 1)"
          onChange={(ev) => e.patchEdges({ labelStart: ev.target.value || undefined })}
        />
        <input
          {...PLAIN_TEXT}
          aria-label="End label"
          className={FIELD}
          value={data?.labelEnd ?? ""}
          placeholder="End (e.g. N)"
          onChange={(ev) => e.patchEdges({ labelEnd: ev.target.value || undefined })}
        />
      </div>
    </div>
  );
};

export const PathSection = ({ e }: { e: E }) => (
  <SegmentedRow<EdgePathStyle>
    options={[
      { id: "orthogonal", label: "Elbow" },
      { id: "straight", label: "Straight" },
      { id: "curved", label: "Curved" },
    ]}
    value={e.firstEdge?.data?.pathStyle ?? "orthogonal"}
    onChange={(pathStyle) => e.patchEdges({ pathStyle })}
  />
);

/** line width presets — Normal is the default a new line gets */
const EDGE_WIDTHS = [
  { value: 1, label: "Thin (1px)" },
  { value: DEFAULT_EDGE_WIDTH, label: `Normal (${DEFAULT_EDGE_WIDTH}px)` },
  { value: 2.5, label: "Bold (2.5px)" },
  { value: 4, label: "Heavy (4px)" },
] as const;

export const LineSection = ({ e }: { e: E }) => {
  const data = e.firstEdge?.data;
  const width: number = data?.width ?? DEFAULT_EDGE_WIDTH;
  return (
    <div className="flex flex-col gap-1.5">
      <SegmentedRow<EdgeVariant>
        options={[
          { id: "solid", label: "──" },
          { id: "dashed", label: "– –" },
          { id: "dotted", label: "···" },
          { id: "dashdot", label: "–·–" },
        ]}
        value={data?.variant ?? "solid"}
        onChange={(variant) => e.patchEdges({ variant })}
      />
      <div className="flex items-center gap-1.5">
        <select
          aria-label="Line width"
          className={`flex-1 ${SELECT}`}
          value={String(width)}
          onChange={(ev) => e.patchEdges({ width: Number(ev.target.value) })}
        >
          {EDGE_WIDTHS.map((w) => (
            <option key={w.value} value={String(w.value)}>
              {w.label}
            </option>
          ))}
          {/* a width set before the presets changed still shows as itself */}
          {EDGE_WIDTHS.some((w) => w.value === width) ? null : (
            <option value={String(width)}>{`Custom (${width}px)`}</option>
          )}
        </select>
        <button
          type="button"
          title="Flow animation"
          aria-pressed={data?.animated ?? false}
          onClick={() => e.patchEdges({ animated: !(data?.animated ?? false) })}
          className={`rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
            data?.animated
              ? ACCENT_SURFACE
              : `bg-frame ${TEXT_MUTED} hover:bg-selected hover:text-muted-strong`
          }`}
        >
          Flow
        </button>
      </div>
      <label className={`flex items-center gap-2 text-[11.5px] ${TEXT_MUTED}`}>
        Opacity
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.1}
          value={data?.opacity ?? 1}
          onChange={(ev) => e.patchEdges({ opacity: Number(ev.target.value) })}
          className="flex-1 accent-primary"
        />
      </label>
    </div>
  );
};

export const EndsSection = ({ e }: { e: E }) => {
  const data = e.firstEdge?.data;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`w-9 text-[11px] ${TEXT_MUTED}`}>Start</span>
        <select
          aria-label="Start arrowhead"
          className={`flex-1 ${SELECT}`}
          value={effectiveMarkerStart(data)}
          onChange={(ev) => e.patchEdges({ markerStart: ev.target.value as MarkerShape })}
        >
          {MARKER_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`w-9 text-[11px] ${TEXT_MUTED}`}>End</span>
        <select
          aria-label="End arrowhead"
          className={`flex-1 ${SELECT}`}
          value={effectiveMarkerEnd(data)}
          onChange={(ev) =>
            e.patchEdges({
              markerEnd: ev.target.value as MarkerShape,
              arrow: ev.target.value !== "none",
            })
          }
        >
          {MARKER_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`w-9 text-[11px] ${TEXT_MUTED}`}>Size</span>
        <SegmentedRow<MarkerSize>
          options={[
            { id: "sm", label: "S" },
            { id: "md", label: "M" },
            { id: "lg", label: "L" },
          ]}
          value={data?.markerSize ?? "md"}
          onChange={(markerSize) => e.patchEdges({ markerSize })}
        />
      </div>
    </div>
  );
};

const PresetGrid = <T extends string>({
  presets,
  activeId,
  onPick,
}: {
  presets: readonly { id: T; label: string; hint: string }[];
  activeId: (id: T) => boolean;
  onPick: (id: T) => void;
}) => (
  <div className="grid grid-cols-2 gap-1">
    {presets.map((rel) => (
      <button
        key={rel.id}
        type="button"
        title={rel.hint}
        aria-pressed={activeId(rel.id)}
        onClick={() => onPick(rel.id)}
        className={`rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors ${
          activeId(rel.id)
            ? `${ACCENT_SOFT} ring-1 ring-primary`
            : "bg-frame text-muted-strong hover:bg-selected"
        }`}
      >
        {rel.label}
      </button>
    ))}
  </div>
);

/** UML presets always; the ERD ones too when every selected line joins two entities */
export const RelationSection = ({ e }: { e: E }) => (
  <div className="flex flex-col gap-3">
    {e.erdEdges ? (
      <div>
        <SectionLabel>ERD relation</SectionLabel>
        <PresetGrid
          presets={ERD_RELATIONS}
          activeId={(id) =>
            e.selectedEdges.every((edge) => matchErdRelation(edge.data ?? {}) === id)
          }
          onPick={(id) => e.patchEdges(ERD_RELATION_STYLE[id])}
        />
        <p className={`mt-1 ${HINT}`}>
          Draw from the "one" side. Use Reverse if you drew it the other way.
        </p>
      </div>
    ) : null}
    <div>
      <SectionLabel>UML relation</SectionLabel>
      <PresetGrid
        presets={UML_RELATIONS}
        activeId={(id) => e.selectedEdges.every((edge) => matchUmlRelation(edge.data ?? {}) === id)}
        onPick={(id) => e.patchEdges(UML_RELATION_STYLE[id])}
      />
      <p className={`mt-1 ${HINT}`}>
        Aggregation and composition put the diamond on the whole end — use Reverse if you drew it
        the other way.
      </p>
    </div>
  </div>
);

/** the swatch the Color buttons show: the selection's own colour */
export const ColorDot = ({ color }: { color: PaletteColor | undefined }) => (
  <span
    aria-hidden="true"
    className="block h-4 w-4 rounded-full"
    style={swatchStyle(color, false)}
  />
);
