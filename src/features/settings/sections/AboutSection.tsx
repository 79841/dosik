import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { toastError } from "../../../shared/lib/toastStore";
import { AppGlyph } from "../../../shared/ui/AppGlyph";
import { Button, Group, Hairline, Row, useLoaded } from "../parts";

export const SOURCE_URL = "https://github.com/79841/dosik";

/** Settings ▸ About (#252): the version, the license and where the source is */
export const AboutSection = () => {
  const version = useLoaded(getVersion);
  return (
    <Group
      label="Dosik"
      head={
        // the app's mark heads the rows, a hairline under it like the one between them
        <>
          <div className="flex items-center gap-3 pb-3.5">
            <span
              aria-hidden="true"
              className="flex size-10 flex-none items-center justify-center rounded-(--radius-island) bg-frame text-ink"
            >
              <AppGlyph size={22} />
            </span>
            <div>
              <p className="m-0 text-[14px] leading-5 font-semibold text-ink">Dosik</p>
              {/* empty while it loads, its line held */}
              <p className="m-0 min-h-[15px] text-[11px] leading-[15px] text-muted">
                {version ? `Version ${version}` : null}
              </p>
            </div>
          </div>
          <Hairline />
        </>
      }
    >
      <Row title="License" description="MIT">
        <Button onClick={() => void invoke("open_notices").catch(toastError)}>
          Third-party notices
        </Button>
      </Row>
      <Row title="Source" description="github.com/79841/dosik">
        <Button external onClick={() => void openUrl(SOURCE_URL).catch(toastError)}>
          Open
        </Button>
      </Row>
    </Group>
  );
};
