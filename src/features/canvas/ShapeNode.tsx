import {
  Handle,
  NodeResizer,
  Position,
  useConnection,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_NODE_SIZE,
  LIFELINE_ACTIVATION_W,
  LIFELINE_HEADER_H,
  ICON_LABEL_H,
  ICON_MIN_GLYPH_H,
  BORDER_TITLE,
  canvasInk,
  nodeLabelColor,
  onCanvasColor,
  FRAGMENT_GUARD,
  THEME_ACT,
  THEME_CANVAS_BG,
  THEME_CARD_BODY,
  THEME_CARD_BORDER,
  THEME_COLOR_TOKENS,
  THEME_EDGE_STROKE,
  THEME_LIFELINE,
  THEME_INK,
  THEME_INK_MUTED,
} from "../../shared/lib/palette";
import { isSequenceMessage } from "../../shared/lib/edgeUtils";
import { handleRatio } from "../../shared/lib/sideAttach";
import { useDiagramStore } from "../../shared/lib/store";
import { useThemeStore } from "../../shared/lib/theme";
import { IMAGE_NODE_MIN } from "../../shared/lib/imageData";
import { resizeFloor } from "../../shared/lib/resizeFloor";
import { IconGlyph } from "../../shared/lib/icons";
import {
  DECOR,
  MAX_BADGE,
  MAX_DESCRIPTION,
  hasBadge,
  hasInlineDecor,
  iconPlacement,
  isStepBadge,
  stepAnchor,
  tagOrigin,
  tagWidth,
} from "../../shared/lib/nodeDecor";
import { contentLift, frameTitleRight } from "../../shared/lib/nodeLayout";
import { visibleActivation } from "../../shared/lib/store/opValidation";
import type { DiagramEdge, DiagramNode } from "../../shared/lib/types";
import { connectDrag, type NodeTextEdit, useCanvasUiStore } from "./canvasUiStore";
import { startPointerDrag } from "../../shared/lib/pointerDrag";
import {
  CLASS_NAME_H,
  CLASS_SECTION_PAD,
  CLASS_STEREOTYPE_FONT,
  CLASS_STEREOTYPE_H,
  CLASS_TEXT_PAD,
  classNodeHeight,
  classNodeWidth,
  splitVisibility,
} from "../../shared/lib/classShape";
import { ClassSvg } from "./ClassSvg";
import { EntitySvg } from "./EntitySvg";
import {
  ENTITY_HEADER_H,
  ENTITY_ROWS_PAD,
  ENTITY_TEXT_PAD,
  entityNodeHeight,
  entityNodeWidth,
} from "../../shared/lib/entityShape";
import { IconNodeSvg } from "./IconNodeSvg";
import { FrameSvg } from "./FrameSvg";
import { FragmentSvg, LifelineSvg } from "./SequenceSvg";
import { ShapeSvg } from "./ShapeSvg";
import {
  cardRowBands,
  compartmentTop,
  editorStartText,
  isListPart,
  type ListPart,
  lineRange,
  type NodeTextPart,
  nextTextPart,
  nodeTextParts,
  pickTextPart,
  STEREOTYPE_LINE,
  textPartChanged,
  textPartEmptied,
  textPartPatch,
} from "./nodeTextParts";
import { type EditorFinish, TextEditor } from "./TextEditor";

export { FragmentSvg, LifelineSvg, ShapeSvg };

/**
 * The ring round a text whose right-click menu is open (#281), in `color`:
 * a tile's own text colour on a tile — which stays light in the dark theme —
 * the canvas ink on the canvas or a card's body. An outline, which an export
 * capture keeps round where a ring's box-shadow turns square (#138); only
 * ever there while a menu is.
 */
const menuOutline = (color: string) =>
  ({ outline: `1.5px solid ${color}`, outlineOffset: 2, borderRadius: 2 }) as const;

/** a member line's leading visibility mark in its drawn, quiet tone (`ClassSvg`) */
const tintVisibility = (line: string) =>
  splitVisibility(line).mark ? [{ from: 0, to: 1, color: THEME_INK_MUTED }] : [];

/** `color` at the description's quiet strength (`DECOR.descriptionOpacity`), as a colour of its own */
const quiet = (color: string) =>
  `color-mix(in srgb, ${color} ${DECOR.descriptionOpacity * 100}%, transparent)`;

/** what a compartment's editor is called — its accessible name */
const LIST_PART_LABEL: Record<ListPart, string> = {
  attributes: "Attributes",
  methods: "Methods",
  columns: "Columns",
};

export const ShapeNode = ({
  id,
  data,
  selected,
  width,
  height,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<DiagramNode>) => {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const commit = useDiagramStore((s) => s.commit);
  const touchedAt = useDiagramStore((s) => s.touched[id]);
  const editRequested = useDiagramStore((s) => s.editRequestId === id);
  // Anchors on a found/lost message render as a visible ● (UML endpoint dot).
  // Must stay above the anchor early-return (hook order).
  const isMessageEndpoint = useDiagramStore(
    (s) =>
      data.shape === "anchor" &&
      s.edges.some((e) => (e.source === id || e.target === id) && isSequenceMessage(e, s.nodes)),
  );
  // shared, not local: React keys nodes by id, so a document swap that reuses
  // an id reuses this instance. A local flag would carry an open editor — and
  // the old text in it — into the new document (#105).
  const edit = useCanvasUiStore((s) => (s.nodeTextEdit?.nodeId === id ? s.nodeTextEdit : null));
  const editingPart = edit?.part ?? null;
  // the name's editor — the paths below that place the label
  const editing = editingPart === "label";
  // the text whose right-click menu is open — outlined while it is (#281)
  const menuText = useCanvasUiStore((s) =>
    s.nodeMenu?.nodeId === id && s.nodeMenu.textPart
      ? `${s.nodeMenu.textPart}:${s.nodeMenu.line ?? 0}`
      : null,
  );
  // what an open compartment holds as it is typed — its card is drawn from it.
  // Tied to the opening it belongs to, so a later one never draws a stale draft.
  const [draft, setDraft] = useState<{ edit: NodeTextEdit; text: string } | null>(null);
  // whether the resize under way has taken its undo step
  const resizeCommitted = useRef(false);
  // the step circle is the ink, so its editor's selection takes the opposite scheme
  const theme = useThemeStore((s) => s.theme);
  // picked as part of a whole group (not stepped into): the group's box carries
  // the handles (#179). Only a selected node pays for the lookup.
  const groupId = data.groupId;
  // Same test as the group box being drawn (`groupOutlineBoxes`): every
  // member picked — a group only partly selected (an agent grouped around the
  // selection) keeps the members' own handles, or nothing would have any.
  const wholeGroup = useDiagramStore((s) => {
    if (selected !== true || groupId === undefined || s.enteredGroup === groupId) return false;
    const members = s.nodes.filter((n) => n.data.groupId === groupId);
    return members.length >= 2 && members.every((n) => n.selected);
  });
  // External edit trigger (Enter key on a selected node): the name.
  useEffect(() => {
    if (!editRequested) return;
    useDiagramStore.getState().requestEditLabel(null);
    const node = useDiagramStore.getState().nodes.find((n) => n.id === id);
    if (node && nodeTextParts(node.data).includes("label")) {
      useCanvasUiStore.getState().setNodeTextEdit({ nodeId: id, part: "label" });
    }
  }, [editRequested, id]);

  const size = DEFAULT_NODE_SIZE[data.shape];
  const w = width ?? size.width;
  const h = height ?? size.height;
  const token = THEME_COLOR_TOKENS[data.color];
  const isText = data.shape === "text";
  const isFragment = data.shape === "fragment";
  const isFrame = data.shape === "frame";
  // fragments and frames are backdrops: click-through body, no handles (#170 D2)
  const backdrop = isFragment || isFrame;
  const isSticky = data.shape === "sticky";
  const isLifeline = data.shape === "lifeline";
  const isClass = data.shape === "class";
  const isIcon = data.shape === "icon";
  const isImage = data.shape === "image";
  const isEntity = data.shape === "entity";
  const agentTouched = touchedAt !== undefined && Date.now() - touchedAt < 2000;

  // Free-arrow endpoint: a small draggable dot. Its single center handle is a
  // pure attachment point (not connectable), so dragging always moves the dot.
  if (data.shape === "anchor") {
    return (
      <div className="group relative h-full w-full cursor-move">
        {agentTouched ? (
          <div
            key={touchedAt}
            className="agent-flash pointer-events-none absolute -inset-1.5 rounded-full"
          />
        ) : null}
        <div
          className={`absolute inset-0 rounded-full border-2 transition-colors ${
            selected
              ? "border-primary bg-surface"
              : "border-transparent bg-transparent group-hover:border-frame-dash group-hover:bg-surface"
          }`}
        />
        {isMessageEndpoint ? (
          // UML found/lost endpoint: a filled dot marking the off-diagram party,
          // in the lines' ink (#210 D8); the 1px gap inside the selection ring
          // keeps selected/hover states readable by luminance, not hue alone.
          <div
            className="pointer-events-none absolute inset-[3px] rounded-full"
            style={{ backgroundColor: THEME_EDGE_STROKE }}
          />
        ) : null}
        <Handle
          id="center"
          type="source"
          position={Position.Top}
          isConnectable={false}
          className="pointer-events-none !m-0 !min-h-0 !min-w-0 !rounded-full !border-0 !bg-transparent"
          // React Flow positions handles with `transform`, which Tailwind v4's
          // translate utilities (modern `translate` property) do NOT override —
          // set it explicitly so the handle center equals the anchor center.
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transform: "none",
          }}
        />
      </div>
    );
  }

  // a box's icon and description sit with its label; its badge is a tag in the
  // top-left corner or a step circle on the top-right (#160, Studio #210). A
  // description being added from the right-click menu sits there already.
  const decorated = hasInlineDecor(data) || editingPart === "description";
  const floor = resizeFloor(data);
  const badge = hasBadge(data) ? data.badge : undefined;
  const step = stepAnchor(data.shape, w, h);
  const tagW = badge === undefined || isStepBadge(badge) ? 0 : tagWidth(badge);
  const tag = tagOrigin(data.shape, w, h, tagW);
  // content the badge would cover moves down past it, as in the exports (#210):
  // centred content moves half its extra top padding, a sticky's all of it
  const lift = contentLift({ data }, w, h);
  const liftPadding =
    lift > 0
      ? { paddingTop: isSticky ? 12 + lift : (data.shape === "cylinder" ? 16 : 0) + lift * 2 }
      : undefined;

  const labelPadding =
    data.shape === "diamond" || data.shape === "hexagon" || data.shape === "parallelogram"
      ? "px-6"
      : data.shape === "cylinder"
        ? "px-3 pt-4"
        : data.shape === "icon"
          ? // a 96px node has no room for the box padding; the line is clipped instead
            "px-1"
          : backdrop || isClass || isEntity
            ? // a frame's title / a fragment's guard / a card's name: the band sets its own inset
              ""
            : "px-3";

  // a sticky note, a frame title and a fragment guard read from the left edge
  // of their area — the drawn text and its editor must agree, or opening the
  // editor jumps the text (#181)
  const labelAlign = isSticky || backdrop || isClass || isEntity ? "text-left" : "text-center";
  // a label is a small bold title; a sticky note, the text shape and a fragment's
  // guard are body text (#210 D5, D11)
  const labelWeight = isSticky || isText || isFragment ? "font-normal" : "font-semibold";
  // view and editor share one size — opening the editor must not resize the text
  const labelSize = isText ? "text-[13px]" : isFragment ? "text-[11px]" : "text-[12px]";
  // a frame's title sits on a canvas-coloured patch that cuts its dashed border (#210 D10)
  const titlePatch = isFrame ? { backgroundColor: THEME_CANVAS_BG } : undefined;
  // a frame's title / a fragment's operator sit on bare canvas (#210 D10, D11)
  const borderTitle = onCanvasColor(data.color, THEME_COLOR_TOKENS, THEME_INK_MUTED);
  // an icon node's glyph, a lost image's frame: the colour with no tile behind it
  const bareInk = canvasInk(data.color, THEME_COLOR_TOKENS);
  // the label's colour — the canvas and the exports ask the same function
  const labelColor = nodeLabelColor(data, THEME_COLOR_TOKENS, {
    ink: THEME_INK,
    inkMuted: THEME_INK_MUTED,
  });
  // a plain sticky's editor fills the note
  const editorFill = isSticky && !decorated ? "h-full" : "";

  /** this node's data as the store has it now — an editor finishes after renders it did not see */
  const storedData = () => useDiagramStore.getState().nodes.find((n) => n.id === id)?.data;
  /**
   * Writes a text the user touched, when it changes once cleaned — no empty
   * undo step, and an untouched editor never writes back over a change an
   * agent made meanwhile (#281).
   */
  const writeText = (part: NodeTextPart, text: string, touched: boolean) => {
    const stored = storedData();
    if (touched && stored && textPartChanged(stored, part, text))
      updateNodeData(id, textPartPatch(part, text));
  };
  /**
   * Save mid-typing (⌘S, #219): written, and the editor stays — even when the
   * text was emptied and the store drops its field: it stays open as a text
   * being added, rather than closing and dropping the focus to the page,
   * where the next Backspace would delete the shape.
   */
  const saveText = (part: NodeTextPart, text: string, touched: boolean) => {
    const ui = useCanvasUiStore.getState();
    const current = ui.nodeTextEdit;
    if (touched && current?.nodeId === id && current.part === part && textPartEmptied(part, text)) {
      const adding = { ...current, adding: true };
      // the compartment's draft belongs to this opening still
      setDraft((d) => (d && d.edit === current ? { ...d, edit: adding } : d));
      ui.setNodeTextEdit(adding);
    }
    writeText(part, text, touched);
  };
  /** an editor closed: keep or drop its text, then close, or open the next text (Tab) */
  const finishText = (how: EditorFinish, text: string, touched: boolean) => {
    const ui = useCanvasUiStore.getState();
    const current = ui.nodeTextEdit;
    if (current?.nodeId !== id) return;
    if (how !== "cancel") writeText(current.part, text, touched);
    if (how === "commit" || how === "cancel") {
      ui.setNodeTextEdit(null);
      return;
    }
    // from what is stored now — a text emptied on Tab is gone and skipped
    const stored = storedData();
    const next = stored ? nextTextPart(stored, current.part, how === "next" ? 1 : -1) : null;
    // a shape with one text keeps its editor going
    if (next === current.part && useCanvasUiStore.getState().nodeTextEdit === current) return;
    useCanvasUiStore.getState().setNodeTextEdit(next ? { nodeId: id, part: next } : null);
  };
  /** what a text's editor opens with and has selected, and where it writes */
  const editorProps = (part: NodeTextPart) => {
    const value = editorStartText(data, part, edit?.adding === true);
    // a compartment opens on the row clicked, or the new last row; the rest, all of it
    const select: [number, number] | undefined = !isListPart(part)
      ? undefined
      : edit?.adding
        ? [value.length, value.length]
        : lineRange(value, edit?.line ?? 0);
    return {
      value,
      select,
      onFinish: finishText,
      onSave: (text: string, touched: boolean) => saveText(part, text, touched),
    };
  };

  // the name's editor, while it is open
  const labelEditor = editing ? (
    <TextEditor
      key="label"
      {...editorProps("label")}
      // a class's or entity's name is drawn on one line of its strip
      multiline={!(isClass || isEntity)}
      nowrap={isIcon || isFrame}
      ariaLabel="Label"
      // a frame's title, a fragment's guard, an icon's or the text shape's
      // words sit on the canvas; every other name on its tile or strip
      scheme={isFrame || isFragment || isIcon || isText ? undefined : "light"}
      hostClassName={`w-full ${editorFill}`}
      className={`${labelSize} ${labelWeight} leading-snug ${editorFill} ${labelAlign} ${isFrame ? "px-1.5" : ""}`}
      style={{ color: labelColor, ...titlePatch }}
    />
  ) : null;

  // the description's editor — in the description's place, under the label (#281)
  const descriptionEditor =
    editingPart === "description" ? (
      <TextEditor
        key="description"
        {...editorProps("description")}
        multiline
        maxLength={MAX_DESCRIPTION}
        ariaLabel="Description"
        scheme="light"
        hostClassName="w-full"
        className={`text-[11px] font-normal leading-snug ${isSticky ? "text-left" : "text-center"}`}
        // the drawn description's 65% as the colour's own — an opacity on the
        // element would wash out the selection drawn under the text too
        style={{ color: quiet(token.text) }}
      />
    ) : undefined;

  // the badge's editor — inside the tag, or the step circle (#281)
  const stepBadge = badge !== undefined && isStepBadge(badge);
  const badgeEditor =
    editingPart === "badge" ? (
      <TextEditor
        key="badge"
        {...editorProps("badge")}
        multiline={false}
        maxLength={MAX_BADGE}
        ariaLabel="Badge"
        // a tag is a light cap; a step circle is the ink — the page's opposite
        scheme={stepBadge ? (theme === "dark" ? "light" : "dark") : "light"}
        className="text-center"
      />
    ) : null;

  // a compartment being typed: the card is drawn from its lines, growing with
  // them; an emptied compartment keeps one row while it is open (#281)
  const listPart: ListPart | null =
    editingPart !== null && isListPart(editingPart) ? editingPart : null;
  const listText =
    listPart === null
      ? null
      : draft !== null && draft.edit === edit
        ? draft.text
        : editorStartText(data, listPart, edit?.adding === true);
  const liveData =
    listPart && listText !== null ? { ...data, [listPart]: listText.split("\n") } : data;
  const cardW =
    listPart === null ? w : isClass ? classNodeWidth(liveData, w) : entityNodeWidth(liveData, w);
  const cardH =
    listPart === null
      ? h
      : Math.max(h, isClass ? classNodeHeight(liveData) : entityNodeHeight(liveData.columns));
  const listPad = isEntity ? ENTITY_TEXT_PAD : CLASS_TEXT_PAD;
  // the first row, under the compartment's rule and padding — on the card as drawn
  const listTop =
    listPart === null
      ? 0
      : compartmentTop(liveData, listPart) + (isEntity ? ENTITY_ROWS_PAD : CLASS_SECTION_PAD);

  return (
    <div
      // a backdrop covers what it holds — letting its root capture clicks
      // would trap everything inside it. Only its painted parts are grabbable.
      className={`group relative h-full w-full ${backdrop ? "pointer-events-none" : ""}`}
      // the rendered box's CSS floor, not the resize floor (`resizeFloor`) — a
      // class or entity box sizes itself from its text before any resize
      style={{
        minWidth: isLifeline ? 80 : isImage ? IMAGE_NODE_MIN : 40,
        minHeight: isLifeline
          ? 120
          : isIcon
            ? ICON_MIN_GLYPH_H + ICON_LABEL_H
            : isImage
              ? IMAGE_NODE_MIN
              : 28,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // in a group, a double-click steps in and picks this shape alone (#171)
        useDiagramStore.getState().pickInGroup(id);
        // the text under the pointer opens — a description, a badge, a row —
        // anywhere else the name; an image draws no text to open (#8, #281)
        const mark =
          (e.target as Element).closest<HTMLElement>("[data-text-part]") ??
          // a step circle sits under the corner resize grip of a selected
          // shape: a double-click on the grip within the circle is the circle's
          [...e.currentTarget.querySelectorAll<HTMLElement>('[data-text-part="badge"]')].find(
            (el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width > 0 &&
                e.clientX >= r.left &&
                e.clientX <= r.right &&
                e.clientY >= r.top &&
                e.clientY <= r.bottom
              );
            },
          );
        const picked = pickTextPart(data, mark?.dataset.textPart, mark?.dataset.textLine);
        if (picked) useCanvasUiStore.getState().setNodeTextEdit({ nodeId: id, ...picked });
      }}
    >
      <NodeResizer
        // a whole group resizes from its own box, not member by member (#179)
        isVisible={selected === true && !wholeGroup}
        // a picture keeps its proportions (#8)
        keepAspectRatio={isImage}
        // a class box may not be dragged narrower/shorter than its own text —
        // the store enforces the same floor when the members change. A
        // picture's floor is the size it may start at, so a thin strip's first
        // resize does not break its proportions (#155). A group resize
        // honours the same floors (`resizeFloor`).
        minWidth={floor.width}
        minHeight={floor.height}
        // one undo step per resize, taken at its first move — React Flow calls
        // onResizeStart on the press already, so a double-click on the corner
        // grip (over a step circle, #281) would leave empty steps
        onResizeStart={() => {
          resizeCommitted.current = false;
        }}
        onResize={() => {
          if (resizeCommitted.current) return;
          resizeCommitted.current = true;
          commit();
        }}
        onResizeEnd={() => {
          // resizing rescales the pct anchors — restore horizontal messages
          if (isLifeline) useDiagramStore.getState().resnapMessages([id]);
        }}
        // `dosik-resize-line` turns the 1px control into a 10px grab band with
        // the hairline drawn by a centred ::after (#70). The colour rides
        // `currentColor`, hence text-* rather than border-*.
        // The resizer lives inside the (pointer-events-none) frame root, so a
        // fragment has to switch pointer events back on here (#38).
        lineClassName={`dosik-resize-line text-primary/60 ${backdrop ? "!pointer-events-auto" : ""}`}
        handleClassName={`!z-20 !h-2.5 !w-2.5 !rounded-full !border-2 !border-primary !bg-surface ${backdrop ? "!pointer-events-auto" : ""}`}
      />
      {agentTouched ? (
        <div
          key={touchedAt}
          className="agent-flash pointer-events-none absolute -inset-2 rounded-lg"
        />
      ) : null}
      {isImage ? (
        <ImageBody src={data.src} stroke={bareInk} />
      ) : !isText ? (
        // Studio tiles sit flat on the page — no shadows (#210 D4)
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {isFrame ? (
            <FrameSvg width={w} height={h} line={token.line} />
          ) : isEntity ? (
            <EntitySvg
              width={cardW}
              height={cardH}
              fill={token.fill}
              body={THEME_CARD_BODY}
              border={THEME_CARD_BORDER}
              text={token.text}
              ink={THEME_INK}
              muted={THEME_INK_MUTED}
              name={data.label}
              columns={liveData.columns}
              // an editor sits on the text it opens — never two copies (#174, #281)
              editingPart={editingPart ?? undefined}
            />
          ) : isClass ? (
            <ClassSvg
              width={cardW}
              height={cardH}
              fill={token.fill}
              body={THEME_CARD_BODY}
              border={THEME_CARD_BORDER}
              text={token.text}
              ink={THEME_INK}
              muted={THEME_INK_MUTED}
              name={data.label}
              stereotype={data.stereotype}
              isAbstract={data.isAbstract}
              attributes={liveData.attributes}
              methods={liveData.methods}
              // an editor sits on the text it opens — never two copies (#174, #281)
              editingPart={editingPart ?? undefined}
            />
          ) : isFragment ? (
            <FragmentSvg
              width={w}
              height={h}
              line={token.line}
              text={borderTitle}
              patch={THEME_CANVAS_BG}
              kind={data.fragmentKind ?? "alt"}
              branches={data.branches}
            />
          ) : isLifeline ? (
            <LifelineSvg
              width={w}
              height={h}
              fill={token.fill}
              line={THEME_LIFELINE}
              act={THEME_ACT}
              ink={THEME_INK}
              activations={data.activations}
              destroyY={data.destroyY}
            />
          ) : isIcon ? (
            <IconNodeSvg icon={String(data.icon ?? "")} width={w} height={h} stroke={bareInk} />
          ) : (
            <ShapeSvg
              shape={data.shape}
              width={w}
              height={h}
              fill={token.fill}
              cap={token.cap}
              stroke={token.glyph}
            />
          )}
        </svg>
      ) : null}
      {/* a class's or entity's rows: where a double-click on one lands (#281) */}
      {isClass || isEntity
        ? cardRowBands(data).map((band) => (
            <Fragment key={`${band.part}-${band.line}`}>
              <div
                aria-hidden="true"
                data-text-part={band.part}
                data-text-line={band.line}
                className="absolute inset-x-0"
                style={{ top: band.top, height: band.height }}
              />
              {menuText === `${band.part}:${band.line}` ? (
                // the row whose menu is open, ringed inside the card's edge
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    left: 4,
                    right: 4,
                    top: band.row.top - 1,
                    height: band.row.height + 2,
                    ...menuOutline(THEME_INK),
                    outlineOffset: 0,
                  }}
                />
              ) : null}
            </Fragment>
          ))
        : null}
      {listPart !== null ? (
        // the compartment's rows as lines, each on its own row (#281 D5)
        <TextEditor
          key={listPart}
          {...editorProps(listPart)}
          multiline
          ariaLabel={LIST_PART_LABEL[listPart]}
          // a member's visibility mark keeps its quiet tone, as drawn
          tintLine={isClass ? tintVisibility : undefined}
          onChange={(text) => edit && setDraft({ edit, text })}
          hostClassName="absolute"
          className={`text-[11.5px] font-normal ${isEntity ? "leading-[20px]" : "leading-[18px]"}`}
          style={{ left: listPad, top: listTop, width: cardW - listPad * 2, color: THEME_INK }}
        />
      ) : null}
      {editingPart === "stereotype" ? (
        // the «stereotype» line: its body typed between the guillemets
        <div
          className="absolute flex h-[14px] items-center whitespace-pre text-[10.5px] leading-[14px]"
          style={{
            left: CLASS_TEXT_PAD,
            top: STEREOTYPE_LINE.top,
            fontSize: CLASS_STEREOTYPE_FONT,
            // quiet as drawn, in the colour rather than an opacity that would
            // wash out the selection too
            color: quiet(token.text),
          }}
        >
          «
          <TextEditor
            key="stereotype"
            {...editorProps("stereotype")}
            multiline={false}
            scheme="light"
            ariaLabel="Stereotype"
          />
          »
        </div>
      ) : null}
      {/* the class box paints its own compartments; its name edits in the
          shared layer below while `editing` */}
      {((isClass || isEntity) && !editing) || isImage ? null : (
        <div
          // a frame's guard strip spans the full width, so the container must stay
          // click-through — only the text itself is a target
          className={`absolute inset-x-0 flex ${isSticky ? "items-start p-3" : "items-center justify-center"} ${labelPadding} ${backdrop ? "pointer-events-none" : ""}`}
          style={{
            ...(isLifeline
              ? { top: 0, height: LIFELINE_HEADER_H }
              : isClass
                ? // the name's own compartment, under the «stereotype» line if any (#174),
                  // left-aligned on the card's strip (#210 D13)
                  {
                    top: data.stereotype ? CLASS_STEREOTYPE_H : 0,
                    height: CLASS_NAME_H,
                    justifyContent: "flex-start",
                    paddingLeft: CLASS_TEXT_PAD,
                    paddingRight: CLASS_TEXT_PAD,
                  }
                : isEntity
                  ? // the header strip the name is painted on (#174)
                    {
                      top: 0,
                      height: Math.min(ENTITY_HEADER_H, h),
                      justifyContent: "flex-start",
                      paddingLeft: ENTITY_TEXT_PAD,
                      paddingRight: ENTITY_TEXT_PAD,
                    }
                  : isIcon
                    ? // the label sits under the glyph, not over it
                      { bottom: 0, height: ICON_LABEL_H }
                    : isFrame
                      ? // the title is set into the top border (#210 D10); the strip
                        // under it stays the grab area (FrameSvg)
                        {
                          top: -BORDER_TITLE.height / 2,
                          height: BORDER_TITLE.height,
                          left: BORDER_TITLE.inset,
                          right: frameTitleRight(data),
                          justifyContent: "flex-start",
                        }
                      : isFragment
                        ? // the guard sits inside, at the top-left (#210 D11)
                          {
                            top: FRAGMENT_GUARD.top,
                            height: FRAGMENT_GUARD.height,
                            left: FRAGMENT_GUARD.left,
                            right: FRAGMENT_GUARD.right,
                            justifyContent: "flex-start",
                          }
                        : { top: 0, bottom: 0 }),
            ...liftPadding,
          }}
        >
          {editing ? (
            decorated ? (
              // the description stays under the label being edited (#174)
              <DecoratedLabel
                data={data}
                color={token.text}
                iconColor={token.glyph}
                height={h}
                weight={labelWeight}
                alignStart={isSticky}
                label={labelEditor}
              />
            ) : (
              labelEditor
            )
          ) : decorated ? (
            <DecoratedLabel
              data={data}
              color={token.text}
              iconColor={token.glyph}
              height={h}
              weight={labelWeight}
              alignStart={isSticky}
              description={descriptionEditor}
              outlined={menuText === "description:0"}
            />
          ) : (
            <span
              className={`${labelSize} ${labelWeight} leading-snug ${
                // the icon label has one fixed line under the glyph — it must
                // not wrap up into the glyph — and a frame's title one line on
                // its border (#210 D10): both clip with an ellipsis instead
                isIcon || isFrame
                  ? "overflow-hidden text-ellipsis whitespace-nowrap"
                  : "whitespace-pre-wrap break-words"
              } ${labelAlign} ${
                backdrop ? "pointer-events-auto w-max max-w-full" : "w-full"
              } ${isFrame ? "px-1.5" : ""}`}
              style={{ color: labelColor, ...titlePatch }}
              title={isIcon && data.label ? data.label : undefined}
            >
              {data.label || (isText ? "Text" : isFrame ? "Frame" : "")}
            </span>
          )}
        </div>
      )}
      {badge === undefined && badgeEditor === null ? null : stepBadge ? (
        // a step number: an ink circle on the shape's top-right anchor, in a ring
        // of canvas so it reads on an ink tile too — a border, which a capture
        // keeps round where a box-shadow turns square (#138, #210). It takes
        // the double-click that opens it (#281), and while it is typed into it
        // sits over the corner grip that covers it otherwise.
        <span
          data-text-part="badge"
          className="pointer-events-auto absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold leading-none"
          style={{
            left: step.x - DECOR.stepRadius - DECOR.stepRing,
            top: step.y - DECOR.stepRadius - DECOR.stepRing,
            backgroundColor: THEME_INK,
            borderColor: THEME_CANVAS_BG,
            color: THEME_CANVAS_BG,
            zIndex: badgeEditor ? 30 : undefined,
            ...(menuText === "badge:0" ? menuOutline(THEME_INK) : {}),
          }}
        >
          {badgeEditor ?? badge}
        </span>
      ) : (
        // a tag in the node's deeper tone, inside the silhouette at the top
        // left — set into the top border at the right on a frame (#210 D7, D23).
        // It takes the double-click that opens it (#281).
        <span
          data-text-part="badge"
          className="pointer-events-auto absolute z-10 inline-flex h-[15px] items-center whitespace-nowrap rounded-[3px] px-[5px] text-[9.5px] font-semibold uppercase leading-none"
          style={{
            // a frame's tag is placed from the right, so it ends exactly at the
            // inset whatever its text measures; every other tag from the left
            ...(isFrame
              ? { right: Math.round((w - tag.x - tagW) * 100) / 100 }
              : { left: Math.round(tag.x * 100) / 100 }),
            top: tag.y,
            backgroundColor: token.cap,
            color: token.text,
            // a frame's tag sits on the canvas, a box's on its tile
            ...(menuText === "badge:0" ? menuOutline(isFrame ? THEME_INK : token.text) : {}),
          }}
        >
          {badgeEditor ?? badge}
        </span>
      )}
      {isText && selected ? (
        <div className="pointer-events-none absolute inset-0 rounded-md border border-dashed border-edge" />
      ) : null}
      {isLifeline ? (
        <>
          <LifelineLineHandle />
          <PlacedHandles nodeId={id} onLine />
          {selected ? (
            <ActivationGrips
              nodeId={id}
              width={w}
              height={h}
              nodeY={positionAbsoluteY}
              activations={data.activations}
            />
          ) : null}
        </>
      ) : backdrop ? null : (
        <>
          <SideHandles />
          <PlacedHandles nodeId={id} onLine={false} />
        </>
      )}
      {/* a frame is a backdrop (#28 decision 1) — giving it handles would let a
          drag that lands inside it connect to the frame instead of opening the
          drop menu, and would swallow drops meant for the empty canvas */}
      {backdrop ? null : <BodyTargetHandle nodeId={id} allowSelf={isLifeline} />}
      <SnapPointsOverlay
        nodeId={id}
        isLifeline={isLifeline}
        nodeX={positionAbsoluteX}
        nodeY={positionAbsoluteY}
      />
    </div>
  );
};

/**
 * The picture of an image node (#8). It fills the box and keeps its own
 * proportions inside it; `draggable={false}` stops the browser's own image
 * drag from hijacking a node drag. A node whose picture was lost (a damaged
 * file) keeps its place as a dashed frame the user can see and delete.
 */
const ImageBody = ({ src, stroke }: { src?: string; stroke: string }) =>
  src ? (
    <img
      src={src}
      alt=""
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-md object-contain"
    />
  ) : (
    <div
      className="absolute inset-0 flex items-center justify-center rounded border-2 border-dashed text-[11px] font-medium"
      style={{ borderColor: stroke, color: stroke }}
    >
      No image
    </div>
  );

/**
 * Drag grips on a selected lifeline's activation bars — one at each span end.
 * `nodrag` keeps React Flow from starting a node drag; the store's live setter
 * clamps to the line range and a minimum height. Commit happens at drag start
 * (after the 4px threshold) so the whole adjustment is one undo frame.
 *
 * These sit above the line handle, so on a selected lifeline the 6px band at
 * each bar end starts a resize instead of a message connection. Deliberate —
 * the rest of the line still connects, and deselecting frees the whole strip.
 */
export const ActivationGrips = ({
  nodeId,
  width: w,
  height: h,
  nodeY,
  activations,
}: {
  nodeId: string;
  width: number;
  height: number;
  nodeY: number;
  activations?: { y0: number; y1: number }[];
}) => {
  const { screenToFlowPosition } = useReactFlow();
  if (!activations?.length) return null;

  const startGripDrag = (e: React.PointerEvent, index: number, end: "y0" | "y1"): void => {
    e.stopPropagation();
    startPointerDrag(e, screenToFlowPosition, {
      onStart: () => useDiagramStore.getState().commit(),
      onMove: (p) => {
        const store = useDiagramStore.getState();
        const cur = store.nodes.find((n) => n.id === nodeId)?.data.activations?.[index];
        if (!cur) return;
        const rel = p.y - nodeY;
        if (end === "y0") store.setActivationLive(nodeId, index, rel, cur.y1);
        else store.setActivationLive(nodeId, index, cur.y0, rel);
      },
    });
  };

  const gripW = LIFELINE_ACTIVATION_W + 8;
  const left = w / 2 - gripW / 2;
  return (
    <>
      {activations.map((raw, i) => {
        // grips sit on the bar as drawn — same rule LifelineSvg uses, so a bar
        // that renders as nothing (stored outside the line) gets no grips either
        const a = visibleActivation(raw, h);
        if (!a) return null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: grips are positional edits
          <Fragment key={i}>
            {/* pointer-only affordances — keyboard/AT editing lives in the
              inspector's numeric inputs, so no interactive role here */}
            <div
              className="nodrag absolute z-10 cursor-ns-resize rounded-sm bg-primary/25 hover:bg-primary/60"
              style={{ left, width: gripW, top: a.y0 - 3, height: 6 }}
              onPointerDown={(e) => startGripDrag(e, i, "y0")}
            />
            <div
              className="nodrag absolute z-10 cursor-ns-resize rounded-sm bg-primary/25 hover:bg-primary/60"
              style={{ left, width: gripW, top: a.y1 - 3, height: 6 }}
              onPointerDown={(e) => startGripDrag(e, i, "y1")}
            />
          </Fragment>
        );
      })}
    </>
  );
};

/**
 * Single source handle covering the lifeline's vertical line — connections can
 * start at any y along the line. The pointer y at connect time decides the
 * final `-<pct>` handle id (resolved in the store, never persisted as "line").
 */
const LifelineLineHandle = () => {
  const { screenToFlowPosition } = useReactFlow();
  return (
    <Handle
      id="line"
      type="source"
      position={Position.Right}
      onPointerDown={(e) => {
        // React Flow reports the strip's center as the connection origin —
        // remember the actual pointer y so the message lands where clicked
        connectDrag.start = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      }}
      className="!m-0 !min-h-0 !min-w-0 !rounded !border-0 !bg-primary/0 opacity-0 transition-opacity group-hover:opacity-100 group-hover:!bg-primary/25"
      style={{
        position: "absolute",
        left: "50%",
        top: LIFELINE_HEADER_H,
        width: 14,
        height: `calc(100% - ${LIFELINE_HEADER_H}px)`,
        transform: "translateX(-50%)",
      }}
    />
  );
};

/**
 * Shown while a line end — a dragged end, a new connection, or the arrow
 * tool's — is near this node: one dot at the exact spot it will attach,
 * anywhere along a side (#204 D4). No ring around the shape: the dot says
 * which shape and where (#204 D16). Lifelines also light the
 * vertical line a message attaches along.
 */
const SnapPointsOverlay = ({
  nodeId,
  isLifeline,
  nodeX,
  nodeY,
}: {
  nodeId: string;
  isLifeline: boolean;
  nodeX: number;
  nodeY: number;
}) => {
  const snap = useCanvasUiStore((s) => (s.snapTarget?.nodeId === nodeId ? s.snapTarget : null));
  if (!snap) return null;
  const spot = (
    <div
      className={`pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-surface ${SNAP_DOT_LIFT}`}
      // on a lifeline the spot is on the line, or on the edge of a bar there (#210)
      style={{ left: snap.point.x - nodeX, top: snap.point.y - nodeY }}
    />
  );
  if (!isLifeline) return spot;
  return (
    <>
      <div
        className="pointer-events-none absolute w-1 -translate-x-1/2 rounded bg-primary/40"
        style={{ left: "50%", top: LIFELINE_HEADER_H, bottom: 0 }}
      />
      {spot}
    </>
  );
};

/**
 * The lift on the snap target's dot. Only drawn mid-drag, so never captured by
 * an export — `exportSafeChrome.test.ts` exempts this name, not the class
 * string: the same grey shadow on an always-on part would re-open #138.
 */
const SNAP_DOT_LIFT = "shadow-raised";

/**
 * A box's label with its description under it (#160). The vector SVG export
 * lays this out from the same numbers (`DECOR` in nodeDecor.ts) — keep
 * the classes in step.
 */
const DecoratedLabel = ({
  data,
  color,
  iconColor,
  height,
  weight,
  alignStart,
  label,
  description,
  outlined = false,
}: {
  data: DiagramNode["data"];
  color: string;
  /** the node's deep tone — the icon sits on its tile */
  iconColor: string;
  /** the box's height decides whether the icon stacks above the label (#210 D6) */
  height: number;
  weight: string;
  alignStart: boolean;
  /** in place of the painted label — its editor, while it is open (#174) */
  label?: React.ReactNode;
  /** in place of the painted description — its editor, while it is open (#281) */
  description?: React.ReactNode;
  /** the description's right-click menu is open (#281) */
  outlined?: boolean;
}) => {
  const align = alignStart ? "text-left" : "text-center";
  const place = data.icon ? iconPlacement(height) : null;
  const icon = String(data.icon ?? "");
  const painted = (className: string) =>
    data.label ? (
      <span
        className={`text-[12px] ${weight} leading-snug whitespace-pre-wrap break-words ${className}`}
        style={{ color }}
      >
        {data.label}
      </span>
    ) : null;
  return (
    <div className={`flex w-full flex-col gap-0.5 ${alignStart ? "items-start" : "items-center"}`}>
      {place === "above" ? (
        <svg
          width={DECOR.iconSize}
          height={DECOR.iconSize}
          aria-hidden="true"
          className="mb-1 h-6 w-6 shrink-0"
        >
          <IconGlyph
            icon={icon}
            size={DECOR.iconSize}
            color={iconColor}
            strokePx={DECOR.iconStrokePx}
          />
        </svg>
      ) : null}
      {place === "left" ? (
        // a short box: the icon beside the label, the two as one left-aligned row
        <div
          className={`flex w-full items-center gap-1.5 ${alignStart ? "justify-start" : "justify-center"}`}
        >
          <svg
            width={DECOR.iconSizeInline}
            height={DECOR.iconSizeInline}
            aria-hidden="true"
            className="h-[18px] w-[18px] shrink-0"
          >
            <IconGlyph
              icon={icon}
              size={DECOR.iconSizeInline}
              color={iconColor}
              strokePx={DECOR.iconStrokePx}
            />
          </svg>
          {label ?? painted("min-w-0 text-left")}
        </div>
      ) : (
        (label ?? painted(`w-full ${align}`))
      )}
      {description ??
        (data.description ? (
          <span
            data-text-part="description"
            className={`w-full text-[11px] font-normal leading-snug whitespace-pre-wrap break-words opacity-65 ${align}`}
            style={{ color }}
          >
            {/* ringed round its words, not across the box's width */}
            {outlined ? (
              <span style={menuOutline(color)}>{data.description}</span>
            ) : (
              data.description
            )}
          </span>
        ) : null)}
    </div>
  );
};

/** 4 connection points, one per side. Drops anywhere on the node also connect. */
const SideHandles = () => (
  <>
    {(["Top", "Right", "Bottom", "Left"] as const).map((pos) => (
      <Handle
        key={pos}
        id={pos.toLowerCase()}
        type="source"
        position={Position[pos]}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-surface !bg-frame-dash opacity-0 transition-opacity group-hover:opacity-100"
      />
    ))}
  </>
);

const HANDLE_SIDE_POS: Record<string, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * Per node, the sorted side-handle ids its edges reference — once per edges
 * array, so each node's selector is a lookup rather than a pass over every
 * edge on every store change (a drag sets the store each frame). `placed`
 * holds only positioned ids (`left-37.5`); a box already has its bare sides
 * as connection dots. `all` holds every side id, for lifelines, which have no
 * dots.
 */
const handleIndex = new WeakMap<
  DiagramEdge[],
  { placed: Map<string, string>; all: Map<string, string> }
>();
const handleKeyForNode = (edges: DiagramEdge[], nodeId: string, all: boolean): string => {
  let index = handleIndex.get(edges);
  if (!index) {
    const sets = { placed: new Map<string, Set<string>>(), all: new Map<string, Set<string>>() };
    const add = (bucket: Map<string, Set<string>>, node: string, id: string) => {
      const ids = bucket.get(node) ?? new Set<string>();
      ids.add(id);
      bucket.set(node, ids);
    };
    for (const e of edges) {
      for (const [node, handle] of [
        [e.source, e.sourceHandle],
        [e.target, e.targetHandle],
      ] as const) {
        if (!handle || !HANDLE_SIDE_POS[handle.split("-")[0] ?? ""]) continue;
        add(sets.all, node, handle);
        if (handle.includes("-")) add(sets.placed, node, handle);
      }
    }
    const join = (bucket: Map<string, Set<string>>) =>
      new Map([...bucket].map(([node, ids]) => [node, [...ids].sort().join("|")]));
    index = { placed: join(sets.placed), all: join(sets.all) };
    handleIndex.set(edges, index);
  }
  return (all ? index.all : index.placed).get(nodeId) ?? "";
};

/**
 * Invisible 1px handles for every positioned handle id on this node's edges.
 * React Flow refuses to render an edge whose handle id has no DOM handle, and
 * these ids are dynamic — a message's `right-37.5`, a box end placed along a
 * side (#204) — so each referenced id gets a real handle at its exact spot.
 * A lifeline's left/right sit on its center line (same geometry as
 * handlePointOnNode); everything else sits on the border.
 */
const PlacedHandles = ({ nodeId, onLine }: { nodeId: string; onLine: boolean }) => {
  const updateNodeInternals = useUpdateNodeInternals();
  // Selecting the joined key (a primitive) rather than `edges` keeps this node
  // from re-rendering on unrelated edge changes — only a change to *its own*
  // handle set gets through, which during a message drag is just the two
  // lifelines that message is attached to.
  const idsKey = useDiagramStore((s) => handleKeyForNode(s.edges, nodeId, onLine));
  const ids = useMemo(() => (idsKey === "" ? [] : idsKey.split("|")), [idsKey]);
  // re-measure when the handle set changes — not on mount with none to measure
  const measured = useRef(`${nodeId}\u0000`);
  useEffect(() => {
    const key = `${nodeId}\u0000${idsKey}`;
    if (key === measured.current) return;
    measured.current = key;
    updateNodeInternals(nodeId);
  }, [idsKey, nodeId, updateNodeInternals]);
  return (
    <>
      {ids.map((hid) => {
        const side = hid.split("-")[0] ?? "right";
        const pct = `${handleRatio(hid) * 100}%`;
        const vertical = side === "left" || side === "right";
        // a lifeline's left/right sit on its center line; everything else on the border
        const across = onLine && vertical ? "50%" : side === "left" || side === "top" ? 0 : "100%";
        return (
          <Handle
            key={hid}
            id={hid}
            type="source"
            position={HANDLE_SIDE_POS[side] ?? Position.Right}
            isConnectable={false}
            className="pointer-events-none !m-0 !h-px !min-h-0 !w-px !min-w-0 !border-0 !bg-transparent"
            style={{
              position: "absolute",
              left: vertical ? across : pct,
              top: vertical ? pct : across,
              transform: "none",
            }}
          />
        );
      })}
    </>
  );
};

/**
 * While a connection drag from another node is in progress, the whole node
 * body becomes a drop target — no need to hit a specific handle.
 *
 * `allowSelf` extends that to the node the drag *started* from, which is what
 * lets a lifeline connect to itself (#99). It matters that this handle has its
 * own id: React Flow rejects a drop whose node **and** handle both match the
 * origin, and a lifeline's line is a single `line` handle, so before this the
 * only thing under the pointer was that same handle. Dropping here yields
 * `body` instead, which the canvas resolves through `resolveMessageConnection`.
 * How far the drag must travel first is `isConnectionAllowed`'s job.
 *
 * This handle is rendered after the lifeline's line handle, so it paints on top
 * and `elementFromPoint` finds it first — the order is load-bearing.
 */
const BodyTargetHandle = ({ nodeId, allowSelf }: { nodeId: string; allowSelf?: boolean }) => {
  const connection = useConnection();
  const active =
    connection.inProgress && (allowSelf === true || connection.fromNode?.id !== nodeId);
  if (!active) return null;
  return (
    <Handle
      id="body"
      type="target"
      position={Position.Top}
      className="!m-0 !min-h-0 !min-w-0 !rounded-none !border-0 !bg-transparent"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none" }}
    />
  );
};
