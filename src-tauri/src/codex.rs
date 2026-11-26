//! OpenAI Codex CLI integration for the in-app AI chat (GPT subscription
//! provider, #119). Mirrors `chat.rs` (Claude Code CLI): find the binary,
//! run one headless turn, classify what came back.
//!
//! Differences from the Claude path, both deliberate:
//! - Codex has no `--append-system-prompt`; the system prompt goes into an
//!   `AGENTS.md` in a private working folder, which Codex reads as project
//!   instructions.
//! - Codex has no allowed-tools list. The `workspace-write` sandbox scoped to
//!   that empty folder (network on, so `curl` can reach the bridge) is the
//!   fence — weaker than Claude's `Bash(curl:*)` allowlist.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::chat::{
    cli_command, ensure_spawnable, find_cli_binary, home_dir, truncated, CliChatResponse, CliError,
    CliErrorKind,
};

const AGENTS_FILE: &str = "AGENTS.md";

fn candidate_paths(home: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(windows) {
        if !home.is_empty() {
            paths.push(PathBuf::from(format!("{home}\\.local\\bin\\codex.exe")));
            paths.push(PathBuf::from(format!(
                "{home}\\AppData\\Roaming\\npm\\codex.exe"
            )));
        }
    } else {
        if !home.is_empty() {
            paths.push(PathBuf::from(format!("{home}/.local/bin/codex")));
            paths.push(PathBuf::from(format!("{home}/.npm-global/bin/codex")));
        }
        paths.push(PathBuf::from("/opt/homebrew/bin/codex"));
        paths.push(PathBuf::from("/usr/local/bin/codex"));
    }
    paths
}

fn find_codex_cli() -> Option<PathBuf> {
    find_cli_binary("codex", "CODEX_CLI_PATH", candidate_paths(&home_dir()))
}

const INSTALL_HINT: &str =
    "Install it with `npm i -g @openai/codex`, sign in with `codex login` (ChatGPT subscription), \
     or switch to the API key connection in settings. On Windows point CODEX_CLI_PATH at codex.exe \
     — the npm codex.cmd shim cannot take multi-line prompts.";

/// The argv for one turn. `exec` runs headless; `resume <thread>` continues a
/// conversation. The sandbox is `workspace-write` (scoped to the working
/// folder we give it) with network access on so curl can reach the bridge,
/// and approvals off — a headless run has nobody to ask.
pub fn codex_args(
    session_id: Option<&str>,
    model: Option<&str>,
    images: &[std::path::PathBuf],
    prompt: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["exec".into()];
    // pictures that go with the message, each its own `--image=` so the
    // option's list form takes nothing after it — an `exec` option, before `resume`
    for image in images {
        args.push(format!("--image={}", image.display()));
    }
    args.extend(
        [
            "--json",
            "--skip-git-repo-check",
            "--sandbox",
            "workspace-write",
            // `exec` has no --ask-for-approval flag (that is the TUI's); the config
            // override is accepted everywhere and makes the intent explicit
            "-c",
            "approval_policy=never",
            "-c",
            "sandbox_workspace_write.network_access=true",
        ]
        .map(String::from),
    );
    // the composer's model (#252) — an `exec` option, so before `resume`
    if let Some(model) = model {
        args.push("-m".into());
        args.push(model.into());
    }
    if let Some(id) = session_id {
        args.push("resume".into());
        args.push(id.into());
    }
    args.push("--".into());
    args.push(prompt.into());
    args
}

/// Creates the private working folder and writes the system prompt into its
/// `AGENTS.md`, which Codex loads as project instructions.
pub fn prepare_workspace(dir: &Path, system_prompt: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let file = dir.join(AGENTS_FILE);
    // unchanged content is left alone, and a change lands by rename — another
    // app instance sharing the cache folder never reads a half-written file
    if std::fs::read_to_string(&file).ok().as_deref() == Some(system_prompt) {
        return Ok(());
    }
    let tmp = dir.join(format!("{AGENTS_FILE}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, system_prompt).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", file.display())
    })
}

/// Reads `codex exec --json` output (JSON Lines). The thread id comes from
/// `thread.started`; the reply is the last completed `agent_message`. A
/// `turn.failed` or `error` event is a failure even when the exit code is 0.
pub fn parse_codex_jsonl(stdout: &str) -> Result<CliChatResponse, CliError> {
    let mut thread_id: Option<String> = None;
    let mut text: Option<String> = None;
    let mut failure: Option<String> = None;
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match event.get("type").and_then(|t| t.as_str()) {
            Some("thread.started") => {
                thread_id = event
                    .get("thread_id")
                    .and_then(|v| v.as_str())
                    .map(String::from);
            }
            Some("item.completed") => {
                let item = event.get("item");
                match item.and_then(|i| i.get("type")).and_then(|t| t.as_str()) {
                    Some("agent_message") => {
                        text = item
                            .and_then(|i| i.get("text"))
                            .and_then(|t| t.as_str())
                            .map(String::from);
                    }
                    Some("error") => {
                        failure = item
                            .and_then(|i| i.get("message"))
                            .and_then(|m| m.as_str())
                            .map(String::from)
                            .or(Some("Codex turn failed".into()));
                    }
                    _ => {}
                }
            }
            // a turn that recovered and completed after an error event is fine
            Some("turn.completed") => failure = None,
            Some("turn.failed") | Some("error") => {
                let message = event
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .or_else(|| event.get("message").and_then(|m| m.as_str()))
                    .unwrap_or("Codex turn failed")
                    .to_string();
                failure = Some(message);
            }
            _ => {}
        }
    }
    if let Some(message) = failure {
        let lowered = message.to_ascii_lowercase();
        let kind = if lowered.contains("usage limit")
            || lowered.contains("rate limit")
            || lowered.contains("quota")
        {
            CliErrorKind::SessionLimit
        } else {
            CliErrorKind::ApiError
        };
        return Err(CliError::new(kind, message));
    }
    Ok(CliChatResponse {
        text: text.unwrap_or_default(),
        session_id: thread_id,
    })
}

/// Codex 0.116.0 downgrades `workspace-write` to read-only (network off) on
/// Windows unless its experimental Windows sandbox is enabled, so the CLI
/// could never reach the local bridge there — the turn would silently draw
/// nothing. Refuse up front with the way out instead.
const WINDOWS_UNSUPPORTED: &str =
    "GPT · Subscription is not available on Windows yet: the Codex sandbox blocks the local \
     diagram bridge. Use the API key connection in settings.";

/// The Codex CLI as Settings shows it (#252): version, then sign-in —
/// `codex login status` exits 0 when signed in (Codex CLI reference).
#[tauri::command]
pub async fn codex_cli_status() -> Result<crate::chat::CliStatus, String> {
    use crate::chat::CliStatus;
    if cfg!(windows) {
        return Ok(CliStatus {
            version: None,
            signed_in: None,
        });
    }
    tauri::async_runtime::spawn_blocking(|| {
        let none = CliStatus {
            version: None,
            signed_in: None,
        };
        let Some(cli) = find_codex_cli() else {
            return Ok(none);
        };
        if ensure_spawnable(&cli, "CODEX_CLI_PATH", "codex.exe").is_err() {
            return Ok(none);
        }
        let version = crate::chat::output_with_timeout(
            cli_command(&cli).arg("--version"),
            crate::chat::CHECK_TIMEOUT,
        )
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
        if version.is_none() {
            return Ok(none);
        }
        let signed_in = crate::chat::output_with_timeout(
            cli_command(&cli).args(["login", "status"]),
            crate::chat::CHECK_TIMEOUT,
        )
        .map(|o| o.status.success());
        Ok(CliStatus { version, signed_in })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    Ok(base.join("codex-workspace"))
}

/// Runs one chat turn through the Codex CLI in headless mode, signed in with
/// the user's ChatGPT subscription. The prompt is a single argv entry after
/// `--`, so prompt content is never shell-parsed.
#[tauri::command]
pub async fn codex_cli_chat(
    app: AppHandle,
    prompt: String,
    system_prompt: String,
    session_id: Option<String>,
    model: Option<String>,
    // the conversation the pictures were staged for, and those pictures
    conversation: Option<String>,
    images: Option<Vec<String>>,
) -> Result<CliChatResponse, CliError> {
    if cfg!(windows) {
        return Err(CliError::new(
            CliErrorKind::NotInstalled,
            WINDOWS_UNSUPPORTED,
        ));
    }
    let workspace = workspace_dir(&app).map_err(|m| CliError::new(CliErrorKind::Unknown, m))?;
    let images = match (
        crate::chat_files::existing_dir(&app, conversation.as_deref())
            .map_err(|m| CliError::new(CliErrorKind::Unknown, m))?,
        images.unwrap_or_default(),
    ) {
        (_, images) if images.is_empty() => Vec::new(),
        (Some(dir), images) => crate::chat_files::inside(&dir, &images)
            .map_err(|m| CliError::new(CliErrorKind::Unknown, m))?,
        (None, _) => {
            return Err(CliError::new(
                CliErrorKind::Unknown,
                "the message's pictures were not staged",
            ))
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let cli = find_codex_cli().ok_or_else(|| {
            CliError::new(
                CliErrorKind::NotInstalled,
                format!("Codex CLI not found. {INSTALL_HINT}"),
            )
        })?;
        ensure_spawnable(
            &cli,
            "CODEX_CLI_PATH",
            "codex.exe (npm's codex.cmd shim cannot take multi-line prompts)",
        )
        .map_err(|m| CliError::new(CliErrorKind::NotInstalled, m))?;
        prepare_workspace(&workspace, &system_prompt)
            .map_err(|m| CliError::new(CliErrorKind::Unknown, m))?;

        let mut cmd = cli_command(cli);
        cmd.args(codex_args(
            session_id.as_deref(),
            model.as_deref(),
            &images,
            &prompt,
        ))
        .current_dir(&workspace);
        let output = cmd.output().map_err(|e| {
            CliError::new(
                CliErrorKind::SpawnFailed,
                format!("Codex CLI could not start ({e}). {INSTALL_HINT}"),
            )
        })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        // a failed turn is reported inside the JSONL stream, exit code or not
        let parsed = parse_codex_jsonl(&stdout)?;
        if !output.status.success() {
            // stdout is the event stream — never a summary a person should read (#68)
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let summary = truncated(&stderr, 300);
            let lowered = summary.to_ascii_lowercase();
            let kind = if lowered.contains("not logged in") || lowered.contains("login") {
                CliErrorKind::ApiError
            } else {
                CliErrorKind::Unknown
            };
            return Err(CliError::new(
                kind,
                if summary.is_empty() {
                    format!("codex exited with {}", output.status)
                } else {
                    summary
                },
            ));
        }
        Ok(parsed)
    })
    .await
    .map_err(|e| CliError::new(CliErrorKind::Unknown, e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str = r#"{"type":"thread.started","thread_id":"th_123"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"curl -s http://127.0.0.1:4517/api/diagram","exit_code":0}}
{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Reading first."}}
{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"Drew a login flow."}}
{"type":"turn.completed","usage":{"input_tokens":10}}"#;

    #[test]
    fn parses_thread_id_and_last_agent_message() {
        let out = parse_codex_jsonl(STREAM).unwrap();
        assert_eq!(out.session_id.as_deref(), Some("th_123"));
        assert_eq!(out.text, "Drew a login flow.");
    }

    #[test]
    fn a_failed_turn_is_an_error_even_with_exit_zero() {
        let stream = r#"{"type":"thread.started","thread_id":"th_1"}
{"type":"turn.failed","error":{"message":"You have hit your usage limit. Try again at 5pm."}}"#;
        let err = parse_codex_jsonl(stream).unwrap_err();
        assert_eq!(err.kind, CliErrorKind::SessionLimit);
        assert!(err.message.contains("usage limit"));

        let stream = r#"{"type":"error","message":"stream disconnected"}"#;
        let err = parse_codex_jsonl(stream).unwrap_err();
        assert_eq!(err.kind, CliErrorKind::ApiError);
        assert_eq!(err.message, "stream disconnected");
    }

    #[test]
    fn an_error_item_fails_the_turn_unless_it_completes_afterwards() {
        let stream =
            r#"{"type":"item.completed","item":{"type":"error","message":"tool crashed"}}"#;
        assert_eq!(
            parse_codex_jsonl(stream).unwrap_err().message,
            "tool crashed"
        );
        let recovered = r#"{"type":"error","message":"transient"}
{"type":"item.completed","item":{"type":"agent_message","text":"done anyway"}}
{"type":"turn.completed"}"#;
        assert_eq!(parse_codex_jsonl(recovered).unwrap().text, "done anyway");
    }

    #[test]
    fn prepare_workspace_leaves_an_unchanged_file_alone() {
        let dir = std::env::temp_dir().join(format!("dosik-codex-same-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        prepare_workspace(&dir, "same").unwrap();
        let before = std::fs::metadata(dir.join("AGENTS.md"))
            .unwrap()
            .modified()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        prepare_workspace(&dir, "same").unwrap();
        let after = std::fs::metadata(dir.join("AGENTS.md"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(before, after);
        assert!(!dir
            .join(format!("AGENTS.md.{}.tmp", std::process::id()))
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_agent_message_yields_empty_text_not_raw_json() {
        let out = parse_codex_jsonl(r#"{"type":"thread.started","thread_id":"th_2"}"#).unwrap();
        assert_eq!(out.text, "");
        assert_eq!(out.session_id.as_deref(), Some("th_2"));
    }

    #[test]
    fn junk_lines_are_skipped() {
        let out = parse_codex_jsonl("warning: something\n{not json\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok\"}}").unwrap();
        assert_eq!(out.text, "ok");
        assert!(out.session_id.is_none());
    }

    #[test]
    fn args_run_headless_in_a_network_enabled_sandbox_and_resume_a_thread() {
        let fresh = codex_args(None, None, &[], "draw it");
        assert_eq!(fresh[0], "exec");
        assert!(fresh.contains(&"--json".to_string()));
        assert!(fresh.contains(&"--skip-git-repo-check".to_string()));
        let sandbox = fresh.iter().position(|a| a == "--sandbox").unwrap();
        assert_eq!(fresh[sandbox + 1], "workspace-write");
        // `exec` has no --ask-for-approval flag — the policy rides on -c
        assert!(!fresh.contains(&"--ask-for-approval".to_string()));
        assert!(fresh.contains(&"approval_policy=never".to_string()));
        assert!(fresh.contains(&"sandbox_workspace_write.network_access=true".to_string()));
        assert!(!fresh.contains(&"resume".to_string()));
        // the prompt is the last argv entry, after `--`
        assert_eq!(fresh[fresh.len() - 2], "--");
        assert_eq!(fresh[fresh.len() - 1], "draw it");

        let resumed = codex_args(Some("th_9"), None, &[], "-- looks like a flag");
        let resume = resumed.iter().position(|a| a == "resume").unwrap();
        assert_eq!(resumed[resume + 1], "th_9");
        assert_eq!(resumed[resumed.len() - 1], "-- looks like a flag");
        // no model chosen: Codex keeps its configured one
        assert!(!fresh.contains(&"-m".to_string()));
    }

    #[test]
    fn args_hand_pictures_over_right_after_exec_one_flag_each() {
        let images = [
            std::path::PathBuf::from("/c/chat-attachments/c1/m1/a.png"),
            std::path::PathBuf::from("/c/chat-attachments/c1/m1/b.png"),
        ];
        let args = codex_args(Some("th_9"), None, &images, "look");
        assert_eq!(args[0], "exec");
        assert_eq!(args[1], "--image=/c/chat-attachments/c1/m1/a.png");
        assert_eq!(args[2], "--image=/c/chat-attachments/c1/m1/b.png");
        assert_eq!(args[3], "--json");
        assert!(2 < args.iter().position(|a| a == "resume").unwrap());
    }

    #[test]
    fn args_carry_the_chosen_model_before_the_resume_subcommand() {
        let args = codex_args(Some("th_9"), Some("gpt-6-astra"), &[], "go");
        let m = args.iter().position(|a| a == "-m").unwrap();
        assert_eq!(args[m + 1], "gpt-6-astra");
        // an `exec` option: it goes before `resume` and the prompt
        assert!(m < args.iter().position(|a| a == "resume").unwrap());
        assert!(m < args.iter().position(|a| a == "--").unwrap());
    }

    #[test]
    fn prepare_workspace_writes_the_system_prompt_as_agents_md() {
        let dir = std::env::temp_dir().join(format!("dosik-codex-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        prepare_workspace(&dir, "You edit diagrams.").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("AGENTS.md")).unwrap(),
            "You edit diagrams."
        );
        // a second turn overwrites rather than appends
        prepare_workspace(&dir, "v2").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("AGENTS.md")).unwrap(),
            "v2"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_candidates_never_probe_drive_roots() {
        for p in candidate_paths("") {
            assert!(
                !p.to_string_lossy().starts_with("/.") && !p.to_string_lossy().starts_with("\\.")
            );
        }
    }
}
