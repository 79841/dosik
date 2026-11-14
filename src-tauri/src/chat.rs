//! Claude Code CLI integration for the in-app AI chat (subscription provider).

/// Builds a Command that won't flash a console window on Windows
/// (this app is a GUI process; child console processes pop a window otherwise).
pub(crate) fn cli_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub(crate) fn home_dir() -> String {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(var).unwrap_or_default()
}

/// A .cmd/.bat shim (npm global install) can't be used: Rust's std rejects
/// any argument containing newlines when spawning batch files (BatBadBut
/// mitigation), and our system prompt is always multi-line — so every chat
/// turn would fail even though `--version` succeeds.
pub(crate) fn is_batch_shim(path: &std::path::Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some(ext) if ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat")
    )
}

/// Picks a usable executable path from `which`/`where` stdout. `where` can
/// return multiple matches; prefer a native .exe and never return a batch
/// shim (see `is_batch_shim`).
pub(crate) fn pick_path_from_finder(stdout: &str) -> Option<std::path::PathBuf> {
    let lines: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    lines
        .iter()
        .find(|l| l.to_ascii_lowercase().ends_with(".exe"))
        .or_else(|| {
            lines
                .iter()
                .find(|l| !is_batch_shim(std::path::Path::new(**l)))
        })
        .map(std::path::PathBuf::from)
}

/// Fallback install locations checked when the CLI isn't on PATH. Ordered by
/// how the official installer lays things out per platform: the Windows
/// native installer targets `~\.local\bin`, while on macOS/Linux
/// `~/.claude/local` (migrate-installer) predates `~/.local/bin`.
/// Skips home-relative candidates when `home` is empty so we never probe
/// drive-root paths like `\.local\bin\claude.exe`.
fn candidate_paths(home: &str) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if cfg!(windows) {
        if !home.is_empty() {
            paths.push(std::path::PathBuf::from(format!(
                "{home}\\.local\\bin\\claude.exe"
            )));
            paths.push(std::path::PathBuf::from(format!(
                "{home}\\.claude\\local\\claude.exe"
            )));
        }
    } else {
        if !home.is_empty() {
            paths.push(std::path::PathBuf::from(format!(
                "{home}/.claude/local/claude"
            )));
            paths.push(std::path::PathBuf::from(format!(
                "{home}/.local/bin/claude"
            )));
        }
        paths.push(std::path::PathBuf::from("/opt/homebrew/bin/claude"));
        paths.push(std::path::PathBuf::from("/usr/local/bin/claude"));
    }
    paths
}

/// Locates the Claude Code CLI binary, which may not be on PATH when the app
/// is launched from Finder (macOS) or the Start Menu (Windows).
fn find_claude_cli() -> Option<std::path::PathBuf> {
    find_cli_binary("claude", "CLAUDE_CLI_PATH", candidate_paths(&home_dir()))
}

/// Shared lookup for a headless CLI (Claude Code, Codex): an explicit env
/// override, then `which`/`where`, then per-tool install candidates.
pub(crate) fn find_cli_binary(
    program: &str,
    env_override: &str,
    candidates: Vec<std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
    if let Ok(path) = std::env::var(env_override) {
        let p = std::path::PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    let finder = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = cli_command(finder).arg(program).output() {
        if output.status.success() {
            if let Some(path) = pick_path_from_finder(&String::from_utf8_lossy(&output.stdout)) {
                // `where` writes stdout in the console codepage, so non-ASCII
                // profile paths (e.g. C:\Users\<non-ASCII name>) arrive mangled through
                // from_utf8_lossy. Existence-check so a bad path falls through
                // to the env-var based candidates instead of being trusted.
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Rejects a CLI path we know can't survive a chat spawn, with an error the
/// user can act on. Reachable only via CLAUDE_CLI_PATH pointing at a shim —
/// discovery already filters batch files out.
pub(crate) fn ensure_spawnable(
    cli: &std::path::Path,
    env_override: &str,
    native_hint: &str,
) -> Result<(), String> {
    if is_batch_shim(cli) {
        return Err(format!(
            "{} is an npm .cmd shim, which cannot receive multi-line prompts on Windows. \
             Install the native CLI or point {env_override} at {native_hint}.",
            cli.display()
        ));
    }
    Ok(())
}

const CLAUDE_NATIVE_HINT: &str = "claude.exe (irm https://claude.ai/install.ps1 | iex installs it)";

#[tauri::command]
pub async fn claude_cli_version() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cli = find_claude_cli().ok_or_else(|| "Claude Code CLI not found".to_string())?;
        ensure_spawnable(&cli, "CLAUDE_CLI_PATH", CLAUDE_NATIVE_HINT)?;
        let output = cli_command(cli)
            .arg("--version")
            .output()
            .map_err(|e| format!("failed to run claude: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, Debug)]
pub struct CliChatResponse {
    pub text: String,
    pub session_id: Option<String>,
}

/// Why a chat turn failed — the frontend picks wording and follow-up guidance
/// per kind (#68), so this crosses the Tauri boundary as structured data
/// instead of a raw string.
#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliErrorKind {
    SessionLimit,
    ApiError,
    NotInstalled,
    SpawnFailed,
    Unknown,
}

#[derive(serde::Serialize, Debug)]
pub struct CliError {
    pub kind: CliErrorKind,
    pub message: String,
}

impl CliError {
    pub(crate) fn new(kind: CliErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Bounded one-line summary for text we couldn't classify — never dump a whole
/// result JSON into a chat bubble (#68).
pub(crate) fn truncated(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= max {
        return trimmed.to_string();
    }
    let mut end = max;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &trimmed[..end])
}

/// Extracts a classified error from the CLI's `--output-format json` stdout.
/// Returns None when stdout isn't an error result — the CLI reports failures
/// like a spent session limit through `is_error` on stdout (sometimes with
/// exit code 0), so both the success and failure paths must check this first.
fn extract_cli_error(stdout: &str) -> Option<CliError> {
    let parsed = serde_json::from_str::<serde_json::Value>(stdout).ok()?;
    if parsed.get("is_error").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let message = parsed
        .get("result")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let lowered = message.as_deref().unwrap_or("").to_ascii_lowercase();
    let kind = if lowered.contains("session limit")
        || lowered.contains("usage limit")
        || lowered.contains("rate limit")
    {
        CliErrorKind::SessionLimit
    } else if message.is_none() {
        CliErrorKind::Unknown
    } else if parsed.get("terminal_reason").and_then(|v| v.as_str()) == Some("api_error") {
        CliErrorKind::ApiError
    } else {
        CliErrorKind::Unknown
    };
    Some(CliError::new(
        kind,
        message.unwrap_or_else(|| truncated(stdout, 300)),
    ))
}

/// Parses the CLI's `--output-format json` stdout into a chat response,
/// falling back to raw stdout when it isn't valid JSON.
pub fn parse_cli_response(stdout: &str) -> CliChatResponse {
    match serde_json::from_str::<serde_json::Value>(stdout) {
        Ok(parsed) => CliChatResponse {
            text: parsed
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or(stdout)
                .to_string(),
            session_id: parsed
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(String::from),
        },
        Err(_) => CliChatResponse {
            text: stdout.trim().to_string(),
            session_id: None,
        },
    }
}

/// Runs one chat turn through the Claude Code CLI in headless mode. The CLI is
/// authenticated with the user's Claude subscription, and is only allowed to
/// use curl (against the local diagram bridge) as a tool. The prompt is passed
/// after `--` as a single argv entry, so prompt content is never shell-parsed.
#[tauri::command]
pub async fn claude_cli_chat(
    prompt: String,
    system_prompt: String,
    session_id: Option<String>,
) -> Result<CliChatResponse, CliError> {
    tauri::async_runtime::spawn_blocking(move || {
        let cli = find_claude_cli().ok_or_else(|| {
            CliError::new(
                CliErrorKind::NotInstalled,
                "Claude Code CLI not found. Install it and sign in with your Claude subscription, \
                 or switch to the API key connection in settings. On Windows, npm global installs \
                 (claude.cmd) are not supported — use the native installer or set CLAUDE_CLI_PATH.",
            )
        })?;
        ensure_spawnable(&cli, "CLAUDE_CLI_PATH", CLAUDE_NATIVE_HINT)
            .map_err(|m| CliError::new(CliErrorKind::NotInstalled, m))?;

        let mut cmd = cli_command(cli);
        cmd.arg("-p")
            .arg("--output-format")
            .arg("json")
            .arg("--append-system-prompt")
            .arg(&system_prompt)
            .arg("--allowedTools")
            .arg("Bash(curl:*)");
        if let Some(id) = &session_id {
            cmd.arg("--resume").arg(id);
        }
        cmd.arg("--").arg(&prompt);

        let output = cmd.output().map_err(|e| {
            CliError::new(
                CliErrorKind::SpawnFailed,
                format!("Failed to run the Claude CLI: {e}"),
            )
        })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        // the CLI reports failures (spent session limit, api errors) as an
        // is_error result on stdout — with exit code 0 or not — so classify
        // stdout first on both paths instead of leaking the raw JSON (#68)
        if let Some(err) = extract_cli_error(&stdout) {
            return Err(err);
        }
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let summary = if stderr.is_empty() {
                truncated(&stdout, 300)
            } else {
                truncated(&stderr, 300)
            };
            return Err(CliError::new(
                CliErrorKind::Unknown,
                if summary.is_empty() {
                    // the CLI died without a word (e.g. killed by a signal) —
                    // leave at least the exit status as a clue
                    format!("claude exited with {}", output.status)
                } else {
                    summary
                },
            ));
        }

        Ok(parse_cli_response(&stdout))
    })
    .await
    .map_err(|e| CliError::new(CliErrorKind::Unknown, e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // #68 — an error result must not leak out as raw JSON
    const LIMIT_STDOUT: &str = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"duration_api_ms":0,"num_turns":0,"result":"You've hit your session limit · resets 5:10am (Asia/Seoul)","total_cost_usd":0,"usage":{"input_tokens":0},"modelUsage":{},"permission_denials":[],"terminal_reason":"api_error","session_id":"abc"}"#;

    #[test]
    fn session_limit_error_is_classified_with_reset_info() {
        let err = extract_cli_error(LIMIT_STDOUT).expect("is_error result must be an error");
        assert_eq!(err.kind, CliErrorKind::SessionLimit);
        assert!(err.message.contains("resets 5:10am"));
        // the raw JSON envelope must not leak into the message
        assert!(!err.message.contains("total_cost_usd"));
    }

    #[test]
    fn api_error_without_limit_text_is_classified_api_error() {
        let out = r#"{"type":"result","is_error":true,"result":"Internal server error","terminal_reason":"api_error"}"#;
        let err = extract_cli_error(out).unwrap();
        assert_eq!(err.kind, CliErrorKind::ApiError);
        assert_eq!(err.message, "Internal server error");
    }

    #[test]
    fn success_result_is_not_an_error() {
        assert!(extract_cli_error(r#"{"result":"done","is_error":false}"#).is_none());
        assert!(extract_cli_error(r#"{"result":"done"}"#).is_none());
    }

    #[test]
    fn non_json_stdout_is_not_an_error() {
        assert!(extract_cli_error("plain text").is_none());
    }

    #[test]
    fn truncation_is_utf8_boundary_safe() {
        // a 3-byte char straddling the 300-byte cut must not panic (#68)
        let hangul = "한".repeat(200);
        let cut = truncated(&hangul, 300);
        assert!(cut.ends_with('…'));
        assert!(cut.len() <= 300 + '…'.len_utf8());
    }

    #[test]
    fn error_without_usable_message_falls_back_truncated() {
        // no string `result` — fallback must be a bounded summary, not the full dump
        let filler = "x".repeat(2000);
        let out = format!(r#"{{"is_error":true,"detail":"{filler}"}}"#);
        let err = extract_cli_error(&out).unwrap();
        assert_eq!(err.kind, CliErrorKind::Unknown);
        assert!(
            err.message.len() <= 400,
            "message not bounded: {}",
            err.message.len()
        );
    }

    #[test]
    fn parses_json_output() {
        let out = parse_cli_response(r#"{"result":"안녕하세요","session_id":"abc-123"}"#);
        assert_eq!(out.text, "안녕하세요");
        assert_eq!(out.session_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn falls_back_to_raw_stdout() {
        let out = parse_cli_response("plain text\n");
        assert_eq!(out.text, "plain text");
        assert!(out.session_id.is_none());
    }

    #[test]
    fn missing_result_field_keeps_raw_json() {
        let raw = r#"{"other":1}"#;
        let out = parse_cli_response(raw);
        assert_eq!(out.text, raw);
    }

    #[test]
    fn finder_prefers_exe_over_cmd_shim() {
        let stdout = "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\nC:\\Users\\u\\.local\\bin\\claude.exe\r\n";
        let picked = pick_path_from_finder(stdout).unwrap();
        assert!(picked.to_string_lossy().ends_with("claude.exe"));
    }

    #[test]
    fn finder_takes_first_line_when_no_exe() {
        let picked = pick_path_from_finder("/opt/homebrew/bin/claude\n").unwrap();
        assert_eq!(picked, std::path::PathBuf::from("/opt/homebrew/bin/claude"));
    }

    #[test]
    fn finder_returns_none_on_empty_output() {
        assert!(pick_path_from_finder("  \n").is_none());
    }

    #[test]
    fn finder_never_returns_a_batch_shim() {
        let stdout = "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\n";
        assert!(pick_path_from_finder(stdout).is_none());
        let mixed = "C:\\x\\claude.CMD\r\nC:\\y\\claude.bat\r\nC:\\z\\claude\r\n";
        assert_eq!(
            pick_path_from_finder(mixed),
            Some(std::path::PathBuf::from("C:\\z\\claude"))
        );
    }

    #[test]
    fn batch_shim_detection_is_case_insensitive() {
        assert!(is_batch_shim(std::path::Path::new("C:\\a\\claude.CMD")));
        assert!(is_batch_shim(std::path::Path::new("C:\\a\\claude.bat")));
        assert!(!is_batch_shim(std::path::Path::new("C:\\a\\claude.exe")));
        assert!(!is_batch_shim(std::path::Path::new(
            "/usr/local/bin/claude"
        )));
    }

    #[test]
    fn spawnable_rejects_shim_with_actionable_error() {
        let err = ensure_spawnable(
            std::path::Path::new("C:\\npm\\claude.cmd"),
            "CLAUDE_CLI_PATH",
            CLAUDE_NATIVE_HINT,
        )
        .unwrap_err();
        assert!(err.contains("CLAUDE_CLI_PATH"));
        assert!(ensure_spawnable(
            std::path::Path::new("C:\\a\\claude.exe"),
            "CLAUDE_CLI_PATH",
            CLAUDE_NATIVE_HINT
        )
        .is_ok());
    }

    #[test]
    fn empty_home_never_yields_root_relative_candidates() {
        for p in candidate_paths("") {
            let s = p.to_string_lossy().into_owned();
            assert!(
                !s.starts_with('\\') && !s.starts_with("/."),
                "root-relative candidate: {s}"
            );
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_candidates_cover_known_install_locations() {
        let paths = candidate_paths("/Users/u");
        let rendered: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert!(rendered.contains(&"/Users/u/.claude/local/claude".to_string()));
        assert!(rendered.contains(&"/opt/homebrew/bin/claude".to_string()));
    }

    #[cfg(windows)]
    #[test]
    fn windows_candidates_cover_native_installs_only() {
        let paths = candidate_paths("C:\\Users\\u");
        let rendered: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert!(rendered.contains(&"C:\\Users\\u\\.local\\bin\\claude.exe".to_string()));
        assert!(rendered.iter().all(|p| !p.ends_with(".cmd")));
    }
}
