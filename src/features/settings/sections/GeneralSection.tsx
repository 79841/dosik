import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";

import { type ThemePreference, useThemeStore } from "../../../shared/lib/theme";
import { toastError } from "../../../shared/lib/toastStore";
import { showInLabel } from "../../library/fileManager";
import { Button, Group, Groups, Row, Segmented, useLoaded } from "../parts";
import { platformCopy } from "../platformCopy";

const THEMES = ["Light", "Dark", "System"] as const;
type ThemeLabel = (typeof THEMES)[number];
const LABEL: Record<ThemePreference, ThemeLabel> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
const PREFERENCE: Record<ThemeLabel, ThemePreference> = {
  Light: "light",
  Dark: "dark",
  System: "system",
};

/**
 * Settings ▸ General (#252): Appearance (the theme) and Library (where it
 * lives — the folders the library may use come with their own issue).
 */
export const GeneralSection = () => {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const library = useLoaded(() => invoke<{ path: string; shown: string }>("library_root"))?.shown;
  return (
    <Groups>
      <Group title="Appearance">
        <Row title="Theme" description={platformCopy().theme}>
          <Segmented
            label="Theme"
            value={LABEL[preference]}
            options={THEMES}
            onChange={(label) => setPreference(PREFERENCE[label])}
          />
        </Row>
      </Group>
      <Group title="Library">
        <Row title="Location" description={library ?? ""}>
          <Button
            icon={FolderOpen}
            onClick={() => void invoke("show_library_in_finder").catch(toastError)}
          >
            {showInLabel()}
          </Button>
        </Row>
      </Group>
    </Groups>
  );
};
