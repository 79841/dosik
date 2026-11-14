import { useRef, useState } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { Menu } from "../../shared/ui/Menu";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";
import { useAppStore } from "../library/appStore";
import { useLibraryStore } from "../library/libraryStore";
import { namedTarget } from "../library/targets";

/**
 * "New diagrams go to Project · Change" under START (#220 D8). The name is
 * what `targetFolder` picks on the dashboard — the project chosen with Change
 * while it is there, else the most recently edited — so the line says where
 * a new diagram really goes. No project, no line; one project, no Change.
 * The choice is session memory: a restart goes back to the default.
 */
export const TargetLine = () => {
  const folders = useLibraryStore((s) => s.folders);
  const picked = useAppStore((s) => s.newDiagramTarget);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const target = namedTarget(folders, picked);
  if (!target) return null;
  const choices = (folders ?? []).filter((f) => !f.stray);

  const close = (returnFocus: boolean) => {
    setMenuAt(null);
    if (returnFocus) button.current?.focus();
  };

  return (
    <div className="mt-2.5 text-[11.5px] leading-4 text-muted">
      New diagrams go to {/* the project's badge before its name, 4 after "to" (#236 D4, `Main`) */}
      <span className="ml-1 inline-flex items-center gap-1 whitespace-nowrap align-bottom font-semibold text-ink">
        <ProjectBadge id={target.id} name={target.name} size={14} />
        {target.name}
      </span>
      {choices.length > 1 ? (
        <>
          {/* a word space and 4 on each side of the dot, as the boards have it (`Main`) */}{" "}
          <span aria-hidden="true" className="mx-1">
            ·
          </span>{" "}
          <button
            ref={button}
            type="button"
            aria-label="Change project for new diagrams"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setMenuAt(menuAt ? null : { x: box.left, y: box.bottom + 4 });
            }}
            className={`rounded-sm font-semibold text-ink underline decoration-dash underline-offset-[3px] ${FOCUS_RING}`}
          >
            Change
          </button>
        </>
      ) : null}
      {menuAt ? (
        <Menu
          at={menuAt}
          label="New diagrams go to"
          opener={button}
          items={choices.map((f) => ({
            // two projects can share a name ("New project")
            id: f.id,
            label: f.name,
            checked: f.id === target.id,
            onSelect: () => useAppStore.getState().setNewDiagramTarget(f.id),
          }))}
          onSelect={(item) => {
            close(true);
            item.onSelect();
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
};
