//! Settings ▸ Integrations (#252): Dosik's MCP server registered with the AI apps.
//!
//! - **Claude Code** — `claude mcp add --scope user dosik -- <node> <server>`;
//!   read back from `~/.claude.json` (`mcpServers.dosik`, user scope). Written
//!   only through the CLI: the file is Claude Code's own.
//! - **ChatGPT and Codex** — one `[mcp_servers.dosik]` table in
//!   `$CODEX_HOME/config.toml` (`~/.codex`), which the ChatGPT desktop app and
//!   the Codex CLI share. Edited with `toml_edit`, so every other line — and
//!   any key the user added to Dosik's table — stays as it was.
//! - **Claude Desktop** — the bundled `dosik.mcpb`, handed to Claude Desktop,
//!   which asks the user to confirm. Installed state is read from Claude's
//!   `extensions-installations.json` (`extensions["local.mcpb.dosik.dosik"]`)
//!   in its folder: `~/Library/Application Support/Claude` on macOS,
//!   `%APPDATA%\Claude` on Windows.
//!
//! The readers take their folders and probes as arguments, so the tests run on
//! temp folders and never touch the user's files or start other programs.
//! Status is reported as facts; the front end (`pluginStatus.ts`) decides what
//! each row says.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::chat::{cli_command, output_with_timeout, CHECK_TIMEOUT};

/// the name Dosik registers under, everywhere
pub const SERVER_NAME: &str = "dosik";
/// Claude Desktop's id for the bundled extension — `scripts/build-mcp.mjs` derives the same
pub const DESKTOP_EXTENSION_ID: &str = "local.mcpb.dosik.dosik";
/// Claude Desktop's bundle identifier, to find the app without opening anything
pub const CLAUDE_BUNDLE_ID: &str = "com.anthropic.claudefordesktop";
/// the oldest Node the MCP SDK runs on (the packaged server is built for it)
pub const MIN_NODE_MAJOR: u32 = 18;
/// `claude mcp add/remove` may take a moment, never forever
const CLAUDE_MCP_TIMEOUT: Duration = Duration::from_secs(30);
/// how the Codex config is named in its errors — swapped for where it is (`config_shown`)
const CODEX_CONFIG_NAME: &str = "~/.codex/config.toml";

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub command: String,
    pub args: Vec<String>,
}

fn string_list(values: impl Iterator<Item = Option<String>>) -> Vec<String> {
    values.flatten().collect()
}

// ---------- Claude Code ----------

/// `mcpServers.dosik` in Claude Code's user config. An entry that is not a
/// stdio one (a url) has no command: it reads as registered elsewhere, so
/// Update replaces it rather than an `add` that refuses the name.
pub fn claude_code_entry(claude_json: &str) -> Option<Registration> {
    let value: serde_json::Value = serde_json::from_str(claude_json).ok()?;
    let entry = value.get("mcpServers")?.get(SERVER_NAME)?;
    Some(Registration {
        command: entry
            .get("command")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string(),
        args: entry
            .get("args")
            .and_then(|a| a.as_array())
            .map(|a| string_list(a.iter().map(|v| v.as_str().map(str::to_string))))
            .unwrap_or_default(),
    })
}

pub fn claude_add_args(command: &str, args: &[String]) -> Vec<String> {
    let mut out: Vec<String> = ["mcp", "add", "--scope", "user", SERVER_NAME, "--"]
        .map(String::from)
        .to_vec();
    out.push(command.to_string());
    out.extend(args.iter().cloned());
    out
}

pub fn claude_remove_args() -> Vec<String> {
    ["mcp", "remove", SERVER_NAME, "-s", "user"]
        .map(String::from)
        .to_vec()
}

/// The `claude mcp` runs an install takes: an entry already there goes first
/// (`add` refuses a name it has), and if the new `add` fails the old entry is
/// put back, so a failed update never leaves Claude Code with none.
pub fn claude_install_plan(
    registered: Option<&Registration>,
    node: &Path,
    server: &Path,
) -> (Vec<Vec<String>>, Option<Vec<String>>) {
    let add = claude_add_args(
        &node.to_string_lossy(),
        &[server.to_string_lossy().into_owned()],
    );
    match registered {
        Some(old) => (
            vec![claude_remove_args(), add],
            // an entry with no command (a url one) cannot be put back with `add -- <command>`
            (!old.command.is_empty()).then(|| claude_add_args(&old.command, &old.args)),
        ),
        None => (vec![add], None),
    }
}

// ---------- ChatGPT and Codex ----------

/// `$CODEX_HOME/config.toml`, else `~/.codex/config.toml`
pub fn codex_config_path(codex_home: Option<&str>, home: &Path) -> PathBuf {
    match codex_home.filter(|h| !h.is_empty()) {
        Some(dir) => PathBuf::from(dir).join("config.toml"),
        None => home.join(".codex").join("config.toml"),
    }
}

pub fn codex_entry(config: &str) -> Option<Registration> {
    let doc = config.parse::<toml_edit::DocumentMut>().ok()?;
    let entry = doc.get("mcp_servers")?.get(SERVER_NAME)?;
    Some(Registration {
        command: entry.get("command")?.as_str()?.to_string(),
        args: entry
            .get("args")
            .and_then(|a| a.as_array())
            .map(|a| string_list(a.iter().map(|v| v.as_str().map(str::to_string))))
            .unwrap_or_default(),
    })
}

fn parse_config(config: &str) -> Result<toml_edit::DocumentMut, String> {
    config
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("~/.codex/config.toml could not be read: {e}"))
}

/// The config with `[mcp_servers.dosik]` pointing at `node server`. Only
/// `command` and `args` are set: other keys in Dosik's entry (an `env`, a
/// timeout the user added) and everything else in the file stay — an entry
/// written inline (`dosik = { … }`) becomes a table with its keys kept. An
/// entry for another transport (a `url`) is replaced.
pub fn codex_set(config: &str, node: &Path, server: &Path) -> Result<String, String> {
    let mut doc = parse_config(config)?;
    if doc.get("mcp_servers").is_none() {
        let mut servers = toml_edit::Table::new();
        servers.set_implicit(true);
        doc.insert("mcp_servers", toml_edit::Item::Table(servers));
    }
    let servers = doc["mcp_servers"]
        .as_table_mut()
        .ok_or("~/.codex/config.toml has an mcp_servers that is not a table")?;
    // a url entry is another transport and is replaced; any other entry keeps its keys
    let keeps_table = servers
        .get(SERVER_NAME)
        .and_then(|e| e.as_table())
        .is_some_and(|t| !t.contains_key("url"));
    if !keeps_table {
        let table = match servers.get(SERVER_NAME) {
            Some(toml_edit::Item::Value(toml_edit::Value::InlineTable(inline)))
                if !inline.contains_key("url") =>
            {
                inline.clone().into_table()
            }
            _ => toml_edit::Table::new(),
        };
        servers.insert(SERVER_NAME, toml_edit::Item::Table(table));
    }
    let table = servers[SERVER_NAME]
        .as_table_mut()
        .ok_or("Dosik's entry in ~/.codex/config.toml is not a table")?;
    table.insert("command", toml_edit::value(node.to_string_lossy().as_ref()));
    let mut args = toml_edit::Array::new();
    args.push(server.to_string_lossy().as_ref());
    table.insert("args", toml_edit::value(args));
    Ok(doc.to_string())
}

/// the config without `[mcp_servers.dosik]`; unchanged when it has none
pub fn codex_remove(config: &str) -> Result<String, String> {
    let mut doc = parse_config(config)?;
    let removed = doc
        .get_mut("mcp_servers")
        .and_then(|s| s.as_table_like_mut())
        .and_then(|s| s.remove(SERVER_NAME))
        .is_some();
    Ok(if removed {
        doc.to_string()
    } else {
        config.to_string()
    })
}

/// A config file's text: empty when there is none yet, an error for any other
/// trouble — never "empty" for a file that exists but could not be read, which
/// would be written over.
pub fn read_config(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("{} could not be read: {e}", path.display())),
    }
}

/// Writes beside the file and renames over it, so a half-written config never
/// stays. A symlinked config is written where the link points (the link stays
/// a link), and the file keeps its permissions.
pub fn write_atomically(path: &Path, text: &str) -> Result<(), String> {
    use std::io::Write;
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("toml.dosik-tmp");
    let _ = std::fs::remove_file(&tmp);
    // made with the file's own permissions (a new file: owner only), so a config
    // holding a token is never readable by others, not even for a moment
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mode = std::fs::metadata(&target)
            .map(|m| m.permissions().mode() & 0o777)
            .unwrap_or(0o600);
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&tmp)
            .map_err(|e| e.to_string())?
    };
    #[cfg(not(unix))]
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    if let Ok(meta) = std::fs::metadata(&target) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

// ---------- Claude Desktop ----------

/// the version of the Dosik extension Claude Desktop has installed, if any
pub fn desktop_installed_version(installations_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(installations_json).ok()?;
    value
        .get("extensions")?
        .get(DESKTOP_EXTENSION_ID)?
        .get("version")?
        .as_str()
        .map(str::to_string)
}

/// Claude Desktop's own folder in the user's app data — `data_dir` is
/// `~/Library/Application Support` on macOS and `%APPDATA%` on Windows
pub fn claude_support_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("Claude")
}

/// Where Claude Desktop's program may be on Windows: its installer puts it
/// in the user's local app data. An estimate, to be checked on a Windows machine
pub fn claude_desktop_exe_candidates(local_data: &Path) -> Vec<PathBuf> {
    vec![
        local_data.join("AnthropicClaude").join("claude.exe"),
        local_data
            .join("Programs")
            .join("Claude")
            .join("Claude.exe"),
    ]
}

/// Whether Claude Desktop is on this machine. macOS: where apps go, then
/// Spotlight by its bundle id. Windows: its program where its installer puts
/// it, or its folder in the app data. Nothing is opened or revealed.
pub fn claude_app_present(home: &Path, local_data: &Path, support: &Path) -> bool {
    if cfg!(windows) {
        return support.is_dir()
            || claude_desktop_exe_candidates(local_data)
                .iter()
                .any(|p| p.exists());
    }
    if !cfg!(target_os = "macos") {
        return false;
    }
    let places = [
        PathBuf::from("/Applications/Claude.app"),
        home.join("Applications/Claude.app"),
    ];
    if places.iter().any(|p| p.exists()) {
        return true;
    }
    let query = format!("kMDItemCFBundleIdentifier == '{CLAUDE_BUNDLE_ID}'");
    output_with_timeout(
        std::process::Command::new("mdfind").arg(query),
        CHECK_TIMEOUT,
    )
    .is_some_and(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
}

// ---------- Node ----------

/// "v22.18.0" → its major version
pub fn node_major(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// the command that lists `node` on the PATH
pub fn node_finder(windows: bool) -> &'static str {
    if windows {
        "where"
    } else {
        "which"
    }
}

/// the folders under `dir` named for Node versions, newest first
fn versions_newest_first(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut versions: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    versions.sort_by_key(|p| {
        std::cmp::Reverse(
            p.file_name()
                .and_then(|n| n.to_str())
                .and_then(node_major)
                .unwrap_or(0),
        )
    });
    versions
}

/// Node's usual homes on Windows: the installer's, nvm-windows' versions
/// (newest first), Volta's and fnm's. Estimates, to be checked on a Windows machine
pub fn windows_node_candidates(
    program_files: Option<&Path>,
    roaming: Option<&Path>,
    local: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(program_files) = program_files {
        paths.push(program_files.join("nodejs").join("node.exe"));
        paths.push(program_files.join("Volta").join("node.exe"));
    }
    if let Some(roaming) = roaming {
        paths.extend(
            versions_newest_first(&roaming.join("nvm"))
                .into_iter()
                .map(|v| v.join("node.exe")),
        );
        paths.push(
            roaming
                .join("fnm")
                .join("aliases")
                .join("default")
                .join("node.exe"),
        );
    }
    if let Some(local) = local {
        paths.push(local.join("Volta").join("bin").join("node.exe"));
    }
    paths
}

fn node_candidates(home: &str) -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/opt/local/bin/node"),
    ];
    if !home.is_empty() {
        let home = Path::new(home);
        paths.push(home.join(".volta/bin/node"));
        paths.push(home.join(".local/share/fnm/aliases/default/bin/node"));
        paths.push(home.join(".asdf/shims/node"));
        // nvm: newest first
        paths.extend(
            versions_newest_first(&home.join(".nvm/versions/node"))
                .into_iter()
                .map(|v| v.join("bin/node")),
        );
    }
    paths
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct NodeInfo {
    pub path: String,
    pub version: String,
}

/// Picks the Node to register: the first that is new enough, else the first
/// found (so Settings can say it is too old), else None.
pub fn pick_node(found: Vec<NodeInfo>) -> Option<NodeInfo> {
    let new_enough = found
        .iter()
        .find(|n| node_major(&n.version).unwrap_or(0) >= MIN_NODE_MAJOR)
        .cloned();
    new_enough.or_else(|| found.into_iter().next())
}

/// Node for Claude Code and Codex to start the server with — its absolute path
/// goes into their config, so it does not depend on the PATH a GUI app gets
pub fn find_node() -> Option<NodeInfo> {
    let mut paths = Vec::new();
    if let Ok(path) = std::env::var("DOSIK_NODE") {
        paths.push(PathBuf::from(path));
    }
    if let Some(output) = output_with_timeout(
        cli_command(node_finder(cfg!(windows))).arg("node"),
        CHECK_TIMEOUT,
    ) {
        if let Some(path) =
            crate::chat::pick_path_from_finder(&String::from_utf8_lossy(&output.stdout))
        {
            paths.push(path);
        }
    }
    if cfg!(windows) {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
        paths.extend(windows_node_candidates(
            env("ProgramFiles").as_deref(),
            env("APPDATA").as_deref(),
            env("LOCALAPPDATA").as_deref(),
        ));
    } else {
        paths.extend(node_candidates(&crate::chat::home_dir()));
    }
    let mut seen = std::collections::HashSet::new();
    let found = paths
        .into_iter()
        .filter(|p| p.exists() && seen.insert(p.clone()))
        .filter_map(|path| {
            let output = output_with_timeout(cli_command(&path).arg("--version"), CHECK_TIMEOUT)?;
            Some(NodeInfo {
                path: path.to_string_lossy().into_owned(),
                version: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            })
        })
        .collect();
    pick_node(found)
}

// ---------- status ----------

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredFacts {
    pub command: String,
    pub args: Vec<String>,
    /// the command it starts is still there (an absolute path that exists, or a bare name)
    pub command_found: bool,
}

fn registered_facts(registration: Registration) -> RegisteredFacts {
    let path = Path::new(&registration.command);
    RegisteredFacts {
        command_found: !path.is_absolute() || path.exists(),
        command: registration.command,
        args: registration.args,
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeFacts {
    pub cli: bool,
    pub registered: Option<RegisteredFacts>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFacts {
    pub app: bool,
    pub installed_version: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexFacts {
    /// where its config is, as Settings names it (`config_shown`)
    pub config: String,
    pub registered: Option<RegisteredFacts>,
}

/// what Settings ▸ Integrations reads; `pluginStatus.ts` turns it into rows
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginFacts {
    /// the server copy in the app data — None when it is not there
    pub server: Option<String>,
    /// why it is not there (or why the last copy failed)
    pub server_problem: Option<String>,
    pub node: Option<NodeInfo>,
    pub app_version: String,
    pub claude_code: ClaudeCodeFacts,
    pub claude_desktop: DesktopFacts,
    pub codex: CodexFacts,
}

/// the places Plugins reads and writes, from the app (tests build their own)
pub struct PluginPlaces {
    pub home: PathBuf,
    /// the user's local app data (`%LOCALAPPDATA%` on Windows) — where Claude Desktop's program goes
    pub local_data: PathBuf,
    pub server_dir: PathBuf,
    pub mcpb: PathBuf,
    pub claude_support: PathBuf,
    pub codex_config: PathBuf,
}

/// The Codex config as Settings names it: from `~` under the home folder on
/// macOS, whole on Windows — the same rule as the library's paths
pub fn config_shown(places: &PluginPlaces, windows: bool) -> String {
    crate::library::shown_path_for(&places.codex_config, Some(&places.home), windows)
}

/// what had to be asked of the system — found by the app, given by the tests
pub struct Probes {
    pub node: Option<NodeInfo>,
    pub claude_cli: bool,
    pub claude_app: bool,
    pub server_problem: Option<String>,
}

fn places<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PluginPlaces, String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(PluginPlaces {
        server_dir: crate::mcp_install::installed_dir(&data),
        mcpb: app
            .path()
            .resolve("mcp/dosik.mcpb", BaseDirectory::Resource)
            .map_err(|e| e.to_string())?,
        claude_support: claude_support_dir(&app.path().data_dir().map_err(|e| e.to_string())?),
        local_data: app.path().local_data_dir().map_err(|e| e.to_string())?,
        codex_config: codex_config_path(std::env::var("CODEX_HOME").ok().as_deref(), &home),
        home,
    })
}

fn read(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

pub fn facts(places: &PluginPlaces, app_version: &str, probes: Probes) -> PluginFacts {
    let server = places.server_dir.join(crate::mcp_install::SERVER_ENTRY);
    PluginFacts {
        server: server
            .exists()
            .then(|| server.to_string_lossy().into_owned()),
        server_problem: probes.server_problem,
        node: probes.node,
        app_version: app_version.to_string(),
        claude_code: ClaudeCodeFacts {
            cli: probes.claude_cli,
            registered: read(&places.home.join(".claude.json"))
                .as_deref()
                .and_then(claude_code_entry)
                .map(registered_facts),
        },
        claude_desktop: DesktopFacts {
            app: probes.claude_app,
            installed_version: read(&places.claude_support.join("extensions-installations.json"))
                .as_deref()
                .and_then(desktop_installed_version),
        },
        codex: CodexFacts {
            config: config_shown(places, cfg!(windows)),
            registered: read(&places.codex_config)
                .as_deref()
                .and_then(codex_entry)
                .map(registered_facts),
        },
    }
}

#[tauri::command(async)]
pub fn plugins_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<PluginFacts, String> {
    use tauri::Manager;
    let places = places(&app)?;
    let probes = Probes {
        node: find_node(),
        claude_cli: crate::chat::find_claude_cli().is_some(),
        claude_app: claude_app_present(&places.home, &places.local_data, &places.claude_support),
        server_problem: app
            .try_state::<crate::mcp_install::McpServerState>()
            .and_then(|s| s.0.lock().unwrap().clone()),
    };
    Ok(facts(
        &places,
        &app.package_info().version.to_string(),
        probes,
    ))
}

// ---------- actions ----------

fn run_claude(args: &[String]) -> Result<(), String> {
    let cli = crate::chat::find_claude_cli()
        .ok_or("Claude Code not found. Install it, then try again.")?;
    let output = output_with_timeout(cli_command(cli).args(args), CLAUDE_MCP_TIMEOUT)
        .ok_or("Claude Code did not answer in time.")?;
    if output.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&output.stderr);
    let out = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "claude mcp failed: {}",
        crate::chat::truncated(if err.trim().is_empty() { &out } else { &err }, 300)
    ))
}

/// the server copy (repaired if it lost a file) and a Node new enough to run it
fn server_and_node<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    places: &PluginPlaces,
) -> Result<(PathBuf, PathBuf), String> {
    if crate::mcp_install::ensure(app)? == crate::mcp_install::InstallOutcome::NotBundled {
        return Err(crate::mcp_install::NOT_BUNDLED.into());
    }
    let server = places.server_dir.join(crate::mcp_install::SERVER_ENTRY);
    let node =
        find_node().ok_or("Node.js was not found. Install Node.js 18 or later, then try again.")?;
    if node_major(&node.version).unwrap_or(0) < MIN_NODE_MAJOR {
        return Err(format!(
            "Node.js {} is too old — install Node.js 18 or later.",
            node.version
        ));
    }
    Ok((server, PathBuf::from(node.path)))
}

/// Install (or Update) Dosik in one app: `claude-code`, `codex` or `claude-desktop`
#[tauri::command(async)]
pub fn plugin_install<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    target: String,
) -> Result<(), String> {
    let places = places(&app)?;
    match target.as_str() {
        "claude-code" => {
            let (server, node) = server_and_node(&app, &places)?;
            let registered = read(&places.home.join(".claude.json"))
                .as_deref()
                .and_then(claude_code_entry);
            let (steps, restore) = claude_install_plan(registered.as_ref(), &node, &server);
            for (i, step) in steps.iter().enumerate() {
                if let Err(e) = run_claude(step) {
                    // the old entry was removed and the new one did not go in: put it back
                    if i > 0 {
                        if let Some(restore) = &restore {
                            let _ = run_claude(restore);
                        }
                    }
                    return Err(e);
                }
            }
            Ok(())
        }
        "codex" => {
            let (server, node) = server_and_node(&app, &places)?;
            let current = read_config(&places.codex_config)?;
            codex_set(&current, &node, &server)
                .and_then(|next| write_atomically(&places.codex_config, &next))
                .map_err(|e| name_codex_config(e, &places))
        }
        "claude-desktop" => {
            if !places.mcpb.exists() {
                return Err("This build of Dosik carries no Claude Desktop extension.".into());
            }
            open_with_claude(&app, &places, Some(&places.mcpb))
        }
        other => Err(format!("unknown plugin target: {other}")),
    }
}

/// Remove Dosik from Claude Code or Codex — Claude Desktop removes its own extensions
#[tauri::command(async)]
pub fn plugin_remove<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    target: String,
) -> Result<(), String> {
    let places = places(&app)?;
    match target.as_str() {
        "claude-code" => run_claude(&claude_remove_args()),
        "codex" => {
            let current = read_config(&places.codex_config)?;
            let next = codex_remove(&current).map_err(|e| name_codex_config(e, &places))?;
            if next == current {
                return Ok(());
            }
            write_atomically(&places.codex_config, &next)
        }
        other => Err(format!("Dosik cannot remove itself from {other}")),
    }
}

/// an error about the Codex config, naming the file where it is
fn name_codex_config(error: String, places: &PluginPlaces) -> String {
    error.replace(CODEX_CONFIG_NAME, &config_shown(places, cfg!(windows)))
}

/// Whether Windows has a program to open this file's kind with — without
/// one, opening it would only ask the user which app to use
#[cfg(windows)]
fn has_open_handler(file: &Path) -> bool {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_NONE, ASSOCSTR_EXECUTABLE};
    let Some(ext) = file.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let ext = HSTRING::from(format!(".{ext}"));
    let mut len = 0u32;
    // asked for the length only: a handler answers with it, none with an error
    // SAFETY: a lookup with no output buffer; `len` outlives the call
    unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            ASSOCSTR_EXECUTABLE,
            &ext,
            PCWSTR::null(),
            None,
            &mut len,
        )
    }
    .is_ok()
        && len > 0
}

#[cfg(not(windows))]
fn has_open_handler(_file: &Path) -> bool {
    false
}

/// Opens Claude Desktop, handing it `file` (the extension to install) if any.
/// macOS: `open -b` by its bundle id. Windows: the file through its own
/// association when there is one (Claude Desktop registers `.mcpb`) — surer
/// than a guessed program, which may not pass the file on — else Claude
/// Desktop's program with the file; with no file, the program.
fn open_with_claude<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    places: &PluginPlaces,
    file: Option<&Path>,
) -> Result<(), String> {
    if cfg!(windows) {
        use tauri_plugin_opener::OpenerExt;
        let program = claude_desktop_exe_candidates(&places.local_data)
            .into_iter()
            .find(|p| p.exists());
        let spawn = |file: Option<&Path>| {
            program.as_ref().is_some_and(|program| {
                let mut cmd = std::process::Command::new(program);
                if let Some(file) = file {
                    cmd.arg(file);
                }
                cmd.spawn().is_ok()
            })
        };
        let opened = match file {
            Some(file) if has_open_handler(file) => app
                .opener()
                .open_path(file.to_string_lossy(), None::<&str>)
                .is_ok(),
            file => spawn(file),
        };
        return if opened {
            Ok(())
        } else {
            Err("Claude Desktop could not be opened.".into())
        };
    }
    let mut cmd = std::process::Command::new("open");
    cmd.args(["-b", CLAUDE_BUNDLE_ID]);
    if let Some(file) = file {
        cmd.arg(file);
    }
    match output_with_timeout(&mut cmd, CHECK_TIMEOUT) {
        Some(output) if output.status.success() => Ok(()),
        _ => Err("Claude Desktop could not be opened.".into()),
    }
}

/// Plugins ▸ Claude Desktop ▸ Open Claude
#[tauri::command(async)]
pub fn open_claude<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let places = places(&app)?;
    open_with_claude(&app, &places, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg(command: &str, args: &[&str]) -> Registration {
        Registration {
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn claude_code_entry_reads_the_user_scope_dosik_server() {
        let json = r#"{"numStartups":3,"mcpServers":{"dosik":{"type":"stdio","command":"node","args":["/a/server.mjs"],"env":{}},"other":{"command":"x"}}}"#;
        assert_eq!(
            claude_code_entry(json),
            Some(reg("node", &["/a/server.mjs"]))
        );
        assert_eq!(claude_code_entry(r#"{"mcpServers":{"other":{}}}"#), None);
        // a url entry is registered — with no command, so Update replaces it
        assert_eq!(
            claude_code_entry(r#"{"mcpServers":{"dosik":{"url":"http://x"}}}"#),
            Some(reg("", &[]))
        );
        assert_eq!(claude_code_entry("not json"), None);
    }

    #[test]
    fn claude_install_registers_node_and_the_server_for_every_project() {
        let node = Path::new("/usr/local/bin/node");
        let server = Path::new("/d/mcp/server/server.mjs");
        let (steps, restore) = claude_install_plan(None, node, server);
        assert_eq!(
            steps,
            vec![vec![
                "mcp",
                "add",
                "--scope",
                "user",
                "dosik",
                "--",
                "/usr/local/bin/node",
                "/d/mcp/server/server.mjs"
            ]]
        );
        assert_eq!(restore, None);
        assert_eq!(
            claude_remove_args(),
            ["mcp", "remove", "dosik", "-s", "user"]
        );
    }

    #[test]
    fn claude_update_removes_first_and_can_put_the_old_entry_back() {
        let old = reg("node", &["/old/repo/scripts/mcp/server.mjs"]);
        let (steps, restore) =
            claude_install_plan(Some(&old), Path::new("/n/node"), Path::new("/s/server.mjs"));
        assert_eq!(steps[0], claude_remove_args());
        assert_eq!(steps[1].last().unwrap(), "/s/server.mjs");
        assert_eq!(
            restore.unwrap(),
            claude_add_args("node", &["/old/repo/scripts/mcp/server.mjs".to_string()])
        );
    }

    #[test]
    fn claude_update_over_a_url_entry_has_nothing_to_put_back() {
        let old = reg("", &[]);
        let (steps, restore) =
            claude_install_plan(Some(&old), Path::new("/n/node"), Path::new("/s/server.mjs"));
        assert_eq!(steps[0], claude_remove_args());
        assert_eq!(restore, None);
    }

    #[test]
    fn codex_config_lives_in_codex_home_or_dot_codex() {
        assert_eq!(
            codex_config_path(None, Path::new("/Users/a")),
            PathBuf::from("/Users/a/.codex/config.toml")
        );
        assert_eq!(
            codex_config_path(Some("/x/codex"), Path::new("/Users/a")),
            PathBuf::from("/x/codex/config.toml")
        );
        assert_eq!(
            codex_config_path(Some(""), Path::new("/Users/a")),
            PathBuf::from("/Users/a/.codex/config.toml")
        );
    }

    #[test]
    fn codex_set_adds_the_table_to_an_empty_config() {
        let out = codex_set("", Path::new("/n/node"), Path::new("/s/server.mjs")).unwrap();
        assert_eq!(codex_entry(&out), Some(reg("/n/node", &["/s/server.mjs"])));
        assert!(out.contains("[mcp_servers.dosik]"));
    }

    #[test]
    fn codex_set_touches_nothing_but_dosiks_command_and_args() {
        let before = "# my settings\nmodel = \"gpt-6-astra\" # pinned\n\n[mcp_servers.context7]\ncommand = \"npx\"\nargs = [\"-y\", \"@upstash/context7-mcp\"]\n\n[mcp_servers.dosik]\ncommand = \"node\"\nargs = [\"/old/repo/scripts/mcp/server.mjs\"]\nstartup_timeout_sec = 30\n\n[profiles.fast]\nmodel = \"gpt-5.6-luna\"\n";
        let after = codex_set(before, Path::new("/n/node"), Path::new("/s/server.mjs")).unwrap();
        // everything around Dosik's table is byte for byte the same
        assert!(after.starts_with("# my settings\nmodel = \"gpt-6-astra\" # pinned\n\n[mcp_servers.context7]\ncommand = \"npx\"\nargs = [\"-y\", \"@upstash/context7-mcp\"]\n"));
        assert!(after.contains("[profiles.fast]\nmodel = \"gpt-5.6-luna\"\n"));
        // a key the user added to Dosik's table stays
        assert!(after.contains("startup_timeout_sec = 30"));
        assert_eq!(codex_entry(&after).unwrap().args, ["/s/server.mjs"]);
        assert!(!after.contains("/old/repo"));
    }

    #[test]
    fn codex_set_keeps_the_keys_of_an_entry_written_inline() {
        let before = "[mcp_servers]\ndosik = { command = \"node\", args = [\"/old/server.mjs\"], env = { TOKEN = \"x\" }, startup_timeout_sec = 30 }\n";
        let after = codex_set(before, Path::new("/n/node"), Path::new("/s/server.mjs")).unwrap();
        assert_eq!(
            codex_entry(&after),
            Some(reg("/n/node", &["/s/server.mjs"]))
        );
        let doc = after.parse::<toml_edit::DocumentMut>().unwrap();
        let entry = &doc["mcp_servers"]["dosik"];
        assert_eq!(entry["env"]["TOKEN"].as_str(), Some("x"));
        assert_eq!(entry["startup_timeout_sec"].as_integer(), Some(30));
    }

    #[test]
    fn codex_set_replaces_an_entry_that_is_not_stdio() {
        let before = "[mcp_servers.dosik]\nurl = \"http://127.0.0.1:9/mcp\"\n";
        let after = codex_set(before, Path::new("/n/node"), Path::new("/s/server.mjs")).unwrap();
        assert_eq!(
            codex_entry(&after),
            Some(reg("/n/node", &["/s/server.mjs"]))
        );
        assert!(!after.contains("url ="));
    }

    #[test]
    fn codex_set_keeps_a_table_that_has_no_command_yet() {
        let before = "[mcp_servers.dosik]\nstartup_timeout_sec = 9\n";
        let after = codex_set(before, Path::new("/n/node"), Path::new("/s/server.mjs")).unwrap();
        assert_eq!(
            codex_entry(&after),
            Some(reg("/n/node", &["/s/server.mjs"]))
        );
        assert!(after.contains("startup_timeout_sec = 9"));
    }

    #[test]
    fn codex_remove_drops_the_dosik_table_only() {
        let before = "[mcp_servers.context7]\ncommand = \"npx\"\n\n[mcp_servers.dosik]\ncommand = \"node\"\nargs = [\"/s/server.mjs\"]\n";
        let after = codex_remove(before).unwrap();
        assert_eq!(codex_entry(&after), None);
        assert!(after.contains("[mcp_servers.context7]\ncommand = \"npx\"\n"));
        let plain = "model = \"x\"\n";
        assert_eq!(codex_remove(plain).unwrap(), plain);
    }

    #[test]
    fn codex_broken_config_is_an_error_not_a_rewrite() {
        assert!(codex_set("model = = 1", Path::new("/n"), Path::new("/s")).is_err());
        assert_eq!(codex_entry("model = = 1"), None);
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dosik-plugins-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_config_is_empty_only_for_a_missing_file() {
        let dir = temp("read");
        assert_eq!(read_config(&dir.join("none.toml")), Ok(String::new()));
        std::fs::write(dir.join("bad.toml"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_config(&dir.join("bad.toml")).is_err());
        std::fs::write(dir.join("ok.toml"), "a = 1\n").unwrap();
        assert_eq!(read_config(&dir.join("ok.toml")), Ok("a = 1\n".into()));
    }

    #[test]
    fn write_atomically_creates_the_folder_and_leaves_no_temp() {
        let dir = temp("write");
        let path = dir.join(".codex/config.toml");
        write_atomically(&path, "a = 1\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a = 1\n");
        assert!(!path.with_extension("toml.dosik-tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_atomically_makes_a_new_config_readable_by_its_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("mode");
        let path = dir.join("config.toml");
        write_atomically(&path, "a = 1\n").unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_atomically_writes_through_a_symlink_and_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("link");
        let real = dir.join("dotfiles/config.toml");
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::write(&real, "old = 1\n").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = dir.join("config.toml");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomically(&link, "new = 1\n").unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new = 1\n");
        assert_eq!(
            std::fs::metadata(&real).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn desktop_installed_version_reads_claudes_installation_list() {
        let json = r#"{"extensions":{"local.mcpb.dosik.dosik":{"version":"0.1.0","hash":"ab","signatureInfo":{"status":"unsigned"}},"ant.dir.x":{"version":"9"}}}"#;
        assert_eq!(desktop_installed_version(json), Some("0.1.0".into()));
        assert_eq!(desktop_installed_version(r#"{"extensions":{}}"#), None);
        assert_eq!(desktop_installed_version("[]"), None);
    }

    #[test]
    fn node_major_reads_node_version() {
        assert_eq!(node_major("v22.18.0\n"), Some(22));
        assert_eq!(node_major("18.0.0"), Some(18));
        assert_eq!(node_major("v16"), Some(16));
        assert_eq!(node_major("node"), None);
    }

    #[test]
    fn pick_node_prefers_one_new_enough() {
        let old = NodeInfo {
            path: "/usr/local/bin/node".into(),
            version: "v16.20.0".into(),
        };
        let new = NodeInfo {
            path: "/nvm/v22/bin/node".into(),
            version: "v22.18.0".into(),
        };
        assert_eq!(pick_node(vec![old.clone(), new.clone()]), Some(new));
        assert_eq!(pick_node(vec![old.clone()]), Some(old));
        assert_eq!(pick_node(vec![]), None);
    }

    #[test]
    fn facts_read_each_app_from_the_given_places() {
        let root = temp("facts");
        let places = PluginPlaces {
            home: root.join("home"),
            server_dir: root.join("data/mcp/server"),
            mcpb: root.join("res/mcp/dosik.mcpb"),
            claude_support: root.join("home/Library/Application Support/Claude"),
            local_data: root.join("local"),
            codex_config: root.join("home/.codex/config.toml"),
        };
        std::fs::create_dir_all(&places.claude_support).unwrap();
        std::fs::create_dir_all(places.codex_config.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&places.server_dir).unwrap();
        std::fs::write(places.server_dir.join("server.mjs"), "").unwrap();
        // absolute on every platform: "/gone/bin/node" has no drive on Windows, so it reads as a bare name
        let gone_node = places.home.join("gone").join("bin").join("node");
        std::fs::write(
            places.home.join(".claude.json"),
            serde_json::json!({ "mcpServers": { "dosik": { "command": gone_node, "args": ["/x"] } } })
                .to_string(),
        )
        .unwrap();
        std::fs::write(
            places.claude_support.join("extensions-installations.json"),
            r#"{"extensions":{"local.mcpb.dosik.dosik":{"version":"0.1.0"}}}"#,
        )
        .unwrap();
        let probes = Probes {
            node: None,
            claude_cli: true,
            claude_app: true,
            server_problem: None,
        };
        let f = facts(&places, "0.2.0", probes);
        assert_eq!(f.app_version, "0.2.0");
        assert!(f.server.unwrap().ends_with("server.mjs"));
        let registered = f.claude_code.registered.unwrap();
        assert_eq!(registered.args, ["/x"]);
        // the node it points at is gone
        assert!(!registered.command_found);
        assert_eq!(f.claude_desktop.installed_version.as_deref(), Some("0.1.0"));
        // the config, named as Settings shows it on this platform
        if cfg!(windows) {
            assert_eq!(f.codex.config, places.codex_config.to_string_lossy());
        } else {
            assert_eq!(f.codex.config, "~/.codex/config.toml");
        }
        assert_eq!(f.codex.registered, None);
    }

    #[test]
    fn claude_desktops_folder_is_in_the_users_app_data() {
        // macOS: ~/Library/Application Support; Windows: %APPDATA% (roaming)
        assert_eq!(
            claude_support_dir(Path::new("/Users/a/Library/Application Support")),
            PathBuf::from("/Users/a/Library/Application Support/Claude")
        );
        assert_eq!(
            claude_support_dir(Path::new(r"C:\Users\a\AppData\Roaming")),
            Path::new(r"C:\Users\a\AppData\Roaming").join("Claude")
        );
    }

    #[test]
    fn claude_desktops_program_is_looked_for_in_local_app_data_on_windows() {
        let local = Path::new(r"C:\Users\a\AppData\Local");
        assert_eq!(
            claude_desktop_exe_candidates(local),
            vec![
                local.join("AnthropicClaude").join("claude.exe"),
                local.join("Programs").join("Claude").join("Claude.exe"),
            ]
        );
    }

    #[test]
    fn node_is_listed_with_where_on_windows_and_which_elsewhere() {
        assert_eq!(node_finder(true), "where");
        assert_eq!(node_finder(false), "which");
    }

    #[test]
    fn node_on_windows_is_looked_for_where_its_installers_put_it() {
        let root = temp("win-node");
        let roaming = root.join("Roaming");
        let local = root.join("Local");
        let program_files = root.join("Program Files");
        // two nvm-windows versions: the newer is tried first
        std::fs::create_dir_all(roaming.join("nvm/v18.20.0")).unwrap();
        std::fs::create_dir_all(roaming.join("nvm/v22.18.0")).unwrap();
        let found = windows_node_candidates(Some(&program_files), Some(&roaming), Some(&local));
        assert_eq!(found[0], program_files.join("nodejs").join("node.exe"));
        assert_eq!(found[1], program_files.join("Volta").join("node.exe"));
        let nvm22 = found
            .iter()
            .position(|p| p == &roaming.join("nvm/v22.18.0").join("node.exe"))
            .unwrap();
        let nvm18 = found
            .iter()
            .position(|p| p == &roaming.join("nvm/v18.20.0").join("node.exe"))
            .unwrap();
        assert!(nvm22 < nvm18);
        assert!(found.contains(&roaming.join("fnm/aliases/default").join("node.exe")));
        assert!(found.contains(&local.join("Volta/bin").join("node.exe")));
        // none of the folders known: nothing to try
        assert!(windows_node_candidates(None, None, None).is_empty());
    }

    #[test]
    fn the_codex_config_is_named_where_it_is() {
        let places = PluginPlaces {
            home: PathBuf::from("/Users/a"),
            local_data: PathBuf::from("/Users/a/Library/Application Support"),
            server_dir: PathBuf::from("/x"),
            mcpb: PathBuf::from("/x.mcpb"),
            claude_support: PathBuf::from("/Users/a/Library/Application Support/Claude"),
            codex_config: PathBuf::from("/Users/a/.codex/config.toml"),
        };
        if cfg!(unix) {
            assert_eq!(config_shown(&places, false), "~/.codex/config.toml");
        }
        // Windows: whole
        assert_eq!(
            config_shown(&places, true),
            places.codex_config.to_string_lossy()
        );
        // an error names the file where it is
        let error = codex_set(
            "[mcp_servers]\nx = 1\n[[mcp_servers]]",
            Path::new("node"),
            Path::new("s"),
        )
        .unwrap_err();
        assert!(error.contains(CODEX_CONFIG_NAME));
        assert!(name_codex_config(error, &places).contains(&config_shown(&places, cfg!(windows))));
    }
}
