//! Local HTTP bridge for AI agents (tiny_http on 127.0.0.1).
//!
//! Security model: the bridge binds to loopback only, but a malicious web page
//! in the user's browser can still fire cross-origin requests at localhost.
//! Three defenses close that surface without affecting local tools (curl/CLI):
//! - `Host` header must be a loopback host (blocks DNS rebinding)
//! - `POST /api/ops` requires `Content-Type: application/json`, which forces a
//!   CORS preflight in browsers — and no CORS headers are granted
//! - request bodies are capped at `MAX_BODY_BYTES`

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

pub const AGENT_PORT: u16 = 4517;
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const OPS_RESULT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct AgentState {
    /// Latest diagram document JSON pushed by the frontend.
    pub snapshot: Mutex<String>,
    /// the library project the snapshot belongs to (`{id,title}`), or Null
    pub project: Mutex<serde_json::Value>,
    /// Pending HTTP requests waiting for the frontend to apply ops.
    pub pending: Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>,
    /// The port the bridge is listening on — None until it binds, or if it
    /// could not (another app holds it). The in-app chat's CLI is pointed
    /// here, never at a constant (#167).
    pub port: Mutex<Option<u16>>,
}

/// Only loopback hosts are legitimate: browsers send the page's hostname in
/// `Host`, so a DNS-rebinding page (attacker.com → 127.0.0.1) is rejected.
pub fn is_allowed_host(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    let bare = host.rsplit_once(':').map_or(host, |(h, _)| h);
    matches!(bare, "127.0.0.1" | "localhost" | "[::1]")
}

pub fn is_json_content_type(value: Option<&str>) -> bool {
    value
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
        .unwrap_or(false)
}

/// Reads at most `limit` bytes; `Err` when the body exceeds the limit.
pub fn read_body_limited(reader: &mut dyn Read, limit: usize) -> Result<String, String> {
    let mut body = String::new();
    let mut handle = reader.take(limit as u64 + 1);
    handle
        .read_to_string(&mut body)
        .map_err(|_| "failed to read request body".to_string())?;
    if body.len() > limit {
        return Err(format!("request body exceeds {limit} bytes"));
    }
    Ok(body)
}

fn raw_response(
    status: u16,
    content_type: &str,
    body: &str,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_data(body.as_bytes().to_vec())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
        )
}

fn json_response(
    status: u16,
    body: &serde_json::Value,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    raw_response(status, "application/json", &body.to_string())
}

fn header_value<'a>(request: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

/// What `GET /api` says: the endpoints, an example, and a line per op —
/// the quick summary beside `docs/openapi.yaml` (#229 D15: no page ops,
/// `new_diagram`).
fn api_info() -> serde_json::Value {
    json!({
        "name": "Dosik agent bridge",
        "endpoints": {
            "GET /api/diagram": "Current diagram document (JSON). Image src values read as elided:<type>;<KB>KB placeholders — send one back unchanged to keep the picture; ?images=inline returns the data URLs",
            "POST /api/ops": "{ ops: Op[] } — apply diagram edit operations",
            "GET /api/openapi.yaml": "OpenAPI 3.1 spec",
            "GET /api/docs": "Interactive API reference (Scalar)"
        },
        "example": { "ops": [ { "op": "add_node", "node": { "label": "Client", "x": 120, "y": 160 } } ] },
        "ops": [
            "add_node {node:{id?,label,shape?,color?,icon?,badge?,description?,src?,x,y,width?,height?}} — icon: the glyph of shape \"icon\", or a box shape's icon above its label; badge (≤16 chars, a tag inside the top-left corner — 1–3 digits draw a step circle on the top-right corner) on box shapes and frames; description (≤300, under the label) on box shapes only; src (data URL) required with shape \"image\"; columns (\"id uuid PK\" lines) with shape \"entity\"",
            "update_node {id,set:{label?,shape?,color?,icon?,badge?,description?,src?,columns?,x?,y?,width?,height?}} — \"\" removes a box's icon, badge or description, or a frame's badge",
            "delete_node {id}",
            "add_edge {edge:{id?,source,target,label?,labelStart?,labelEnd?,variant?,color?,width?,opacity?,animated?,pathStyle?,markerStart?,markerEnd?,markerSize?,waypoints?}}",
            "update_edge {id,set:{...same style fields as add_edge}}",
            "delete_edge {id}",
            "add_message {message:{id?,from,to,y,label?,variant?,markerEnd?}} — horizontal sequence message between lifelines (self-message when from==to)",
            "add_activation {lifeline,y0,y1} — activation bar on a lifeline (y relative to node top)",
            "set_title {title}",
            "layout {direction?,ids?} — auto-arrange shapes (TB, BT, LR or RL); sequence parts stay put",
            "group {ids,id?} — bind shapes into one group (the user selects and moves them together; groups they touch are folded in; update_node still moves one shape); members carry data.groupId",
            "ungroup {id} — release a group",
            "clear {}",
            "set_diagram {doc} — replaces the whole diagram (title, nodes, edges); a diagram is one canvas — a doc with pages is refused",
            "new_diagram {title?,folder?} — starts another diagram in a new tab (folder: an id from project.path of GET /api/diagram); the ops after it in the batch go to it"
        ],
        "shapes": ["rect","rounded","ellipse","diamond","parallelogram","cylinder","hexagon","sticky","text","lifeline","anchor","fragment","frame","class","icon","image","entity"],
        "icons": ["database","server","cloud","user","queue","cache","storage","function","api","browser","mobile","lock","mail","scheduler","container","balancer","service","document","search","internet","users","gateway","firewall","shield","key","certificate","network","dns","iot","stream","pipeline","backup","disk","cpu","cluster","laptop","desktop","robot","code","terminal","git","bug","config","log","folder","table","graph","chart","metrics","bell","chat","calendar","card","bank","cart","location","image","video"],
        "colors": ["mono","violet","blue","teal","green","amber","rose","gray","ink"]
    })
}

/// Adds `project` — which library project the document belongs to (#114),
/// Null for an external file or a blank — to a snapshot document.
fn with_project(mut doc: serde_json::Value, project: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("project".into(), project);
    }
    doc
}

/// Replaces each image's `src` with `elided:<type>;<KB>KB` — the text
/// `elidedSrc` in `src/shared/lib/imageData.ts` writes. A document read by an
/// agent goes into a model's context whole, and a few pasted screenshots are
/// megabytes of base64 (#155). Sent back unchanged, the placeholder
/// keeps its picture. `?images=inline` skips this for callers that render the
/// document (the MCP server's export and render).
fn elide_images(doc: &mut serde_json::Value) {
    // a diagram is one canvas (#229 D17): its nodes are all there is
    let Some(nodes) = doc.get_mut("nodes").and_then(|n| n.as_array_mut()) else {
        return;
    };
    for node in nodes {
        let Some(data) = node.get_mut("data").and_then(|d| d.as_object_mut()) else {
            continue;
        };
        if data.get("shape").and_then(|s| s.as_str()) != Some("image") {
            continue;
        }
        let Some(src) = data.get("src").and_then(|s| s.as_str()) else {
            continue;
        };
        let Some(rest) = src.strip_prefix("data:") else {
            continue;
        };
        let (Some((kind, _)), Some((_, payload))) = (rest.split_once(';'), rest.split_once(','))
        else {
            continue;
        };
        let padding = payload.len() - payload.trim_end_matches('=').len();
        let bytes = (payload.len() as f64) * 3.0 / 4.0 - padding as f64;
        let placeholder = format!("elided:{kind};{}KB", (bytes / 1024.0).round());
        data.insert("src".into(), serde_json::Value::String(placeholder));
    }
}

fn wants_inline_images(url: &str) -> bool {
    url.split_once('?')
        .map(|(_, query)| query.split('&').any(|pair| pair == "images=inline"))
        .unwrap_or(false)
}

/// `{ ops: [...] }` from a JSON POST, or the error response for it.
fn read_ops_body(request: &mut tiny_http::Request) -> Result<serde_json::Value, serde_json::Value> {
    if !is_json_content_type(header_value(request, "Content-Type")) {
        return Err(
            json!({ "status": 415, "body": { "ok": false, "error": "Content-Type must be application/json" } }),
        );
    }
    let body = read_body_limited(request.as_reader(), MAX_BODY_BYTES)
        .map_err(|e| json!({ "status": 400, "body": { "ok": false, "error": e } }))?;
    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        json!({ "status": 400, "body": { "ok": false, "error": format!("JSON parse error: {e}") } })
    })?;
    let ops = parsed
        .get("ops")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    if !ops.is_array() {
        return Err(
            json!({ "status": 400, "body": { "ok": false, "error": "'ops' array is required" } }),
        );
    }
    Ok(ops)
}

/// Unique per request: two requests in the same nanosecond — the chat and an
/// external agent at once — must not share a slot in `pending`.
fn new_request_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "req-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// Emits `event` with `payload` (plus `requestId`) and waits for the frontend
/// to answer through `pending`. `None` when it did not answer in time.
fn ask_frontend(
    app: &AppHandle,
    event: &str,
    mut payload: serde_json::Value,
) -> Result<Option<serde_json::Value>, ()> {
    let state = app.state::<AgentState>();
    let request_id = new_request_id();
    payload["requestId"] = json!(request_id);
    let (tx, rx) = mpsc::channel();
    state.pending.lock().unwrap().insert(request_id.clone(), tx);
    if app.emit(event, payload).is_err() {
        state.pending.lock().unwrap().remove(&request_id);
        return Err(());
    }
    match rx.recv_timeout(OPS_RESULT_TIMEOUT) {
        Ok(result) => Ok(Some(result)),
        Err(_) => {
            state.pending.lock().unwrap().remove(&request_id);
            Ok(None)
        }
    }
}

fn handle_ops_request(app: &AppHandle, request: &mut tiny_http::Request) -> serde_json::Value {
    let ops = match read_ops_body(request) {
        Ok(ops) => ops,
        Err(response) => return response,
    };
    match ask_frontend(app, "agent:ops", json!({ "ops": ops })) {
        Err(()) => {
            json!({ "status": 500, "body": { "ok": false, "error": "failed to emit event" } })
        }
        Ok(Some(result)) => json!({ "status": 200, "body": result }),
        Ok(None) => {
            json!({ "status": 202, "body": { "ok": true, "queued": true, "note": "timed out waiting for the frontend — check GET /api/diagram to confirm" } })
        }
    }
}

/// `/api/chat/<token>/<diagram|ops>` — the in-app chat's own URLs (#167).
/// A subscription CLI is given them for one turn; the token names the turn,
/// and the frontend knows which diagram page that turn draws on.
pub fn chat_route(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix("/api/chat/")?;
    let (token, action) = rest.split_once('/')?;
    let token_ok = !token.is_empty()
        && token.len() <= 64
        && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    (token_ok && matches!(action, "diagram" | "ops")).then_some((token, action))
}

/// Answers a chat turn's read or edit — status and body come from the
/// frontend, which alone knows the turn (404 unknown, 409 when the user has
/// left the diagram the turn was drawing on).
fn handle_chat_request(
    app: &AppHandle,
    request: &mut tiny_http::Request,
    token: &str,
    action: &str,
) -> serde_json::Value {
    let mut payload = json!({ "token": token, "action": action });
    if action == "ops" {
        match read_ops_body(request) {
            Ok(ops) => payload["ops"] = ops,
            Err(response) => return response,
        }
    }
    match ask_frontend(app, "agent:chat", payload) {
        Err(()) => {
            json!({ "status": 500, "body": { "ok": false, "error": "failed to emit event" } })
        }
        Ok(Some(result)) => result,
        Ok(None) if action == "ops" => {
            json!({ "status": 202, "body": { "ok": true, "queued": true, "note": "timed out waiting for the app — read the diagram to confirm" } })
        }
        Ok(None) => {
            json!({ "status": 504, "body": { "ok": false, "error": "timed out waiting for the app" } })
        }
    }
}

fn handle_request(app: &AppHandle, mut request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("").to_string();

    if !is_allowed_host(header_value(&request, "Host")) {
        let _ = request.respond(json_response(
            403,
            &json!({ "ok": false, "error": "forbidden host" }),
        ));
        return;
    }

    let response = match (method.as_str(), path.as_str()) {
        ("OPTIONS", _) => json_response(204, &json!({})),
        ("GET", "/api/diagram") => {
            let state = app.state::<AgentState>();
            let snapshot = state.snapshot.lock().unwrap().clone();
            let project = state.project.lock().unwrap().clone();
            if snapshot.is_empty() {
                json_response(
                    200,
                    &json!({ "version": 1, "title": "Untitled Diagram", "nodes": [], "edges": [], "project": null }),
                )
            } else {
                match serde_json::from_str::<serde_json::Value>(&snapshot) {
                    Ok(mut doc) => {
                        if !wants_inline_images(&url) {
                            elide_images(&mut doc);
                        }
                        json_response(200, &with_project(doc, project))
                    }
                    Err(_) => json_response(
                        500,
                        &json!({ "ok": false, "error": "snapshot parse error" }),
                    ),
                }
            }
        }
        ("GET", "/api/openapi.yaml") => raw_response(
            200,
            "application/yaml",
            include_str!("../../docs/openapi.yaml"),
        ),
        ("GET", "/api/docs") => raw_response(
            200,
            "text/html; charset=utf-8",
            include_str!("../../docs/api-docs.html"),
        ),
        ("GET", "/") | ("GET", "/api") => json_response(200, &api_info()),
        ("POST", "/api/ops") => {
            let result = handle_ops_request(app, &mut request);
            let status = result["status"].as_u64().unwrap_or(500) as u16;
            json_response(status, &result["body"])
        }
        (method, chat_path) if chat_route(chat_path).is_some() => {
            let (token, action) = chat_route(chat_path).unwrap();
            if (action, method) != ("diagram", "GET") && (action, method) != ("ops", "POST") {
                json_response(405, &json!({ "ok": false, "error": "method not allowed" }))
            } else {
                let (token, action) = (token.to_string(), action.to_string());
                let result = handle_chat_request(app, &mut request, &token, &action);
                let status = result["status"].as_u64().unwrap_or(500) as u16;
                json_response(status, &result["body"])
            }
        }
        _ => json_response(404, &json!({ "ok": false, "error": "not found" })),
    };

    let _ = request.respond(response);
}

pub fn start_agent_server(app: AppHandle) {
    std::thread::spawn(move || {
        let port = std::env::var("DOSIK_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(AGENT_PORT);
        let server = match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(server) => server,
            Err(e) => {
                eprintln!("[agent] failed to start HTTP server (port {port}): {e}");
                return;
            }
        };
        *app.state::<AgentState>().port.lock().unwrap() = Some(port);
        println!("[agent] listening on http://127.0.0.1:{port}");
        for request in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || handle_request(&app, request));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_never_repeat() {
        let a = new_request_id();
        let b = new_request_id();
        assert_ne!(a, b);
    }

    #[test]
    fn chat_routes() {
        assert_eq!(
            chat_route("/api/chat/3f2a-9c/diagram"),
            Some(("3f2a-9c", "diagram"))
        );
        assert_eq!(chat_route("/api/chat/abc/ops"), Some(("abc", "ops")));
        assert_eq!(chat_route("/api/chat/abc/clear"), None);
        assert_eq!(chat_route("/api/chat//ops"), None);
        assert_eq!(chat_route("/api/chat/a.b/ops"), None);
        assert_eq!(chat_route("/api/chat/abc/ops/x"), None);
        assert_eq!(
            chat_route(&format!("/api/chat/{}/ops", "a".repeat(65))),
            None
        );
        assert_eq!(chat_route("/api/ops"), None);
    }

    #[test]
    fn allowed_hosts() {
        assert!(is_allowed_host(Some("127.0.0.1:4517")));
        assert!(is_allowed_host(Some("localhost:4517")));
        assert!(is_allowed_host(Some("localhost")));
        assert!(is_allowed_host(Some("[::1]:4517")));
    }

    #[test]
    fn rejected_hosts() {
        assert!(!is_allowed_host(None));
        assert!(!is_allowed_host(Some("attacker.com")));
        assert!(!is_allowed_host(Some("attacker.com:4517")));
        assert!(!is_allowed_host(Some("127.0.0.1.attacker.com:4517")));
        assert!(!is_allowed_host(Some("192.168.0.10:4517")));
    }

    #[test]
    fn json_content_type() {
        assert!(is_json_content_type(Some("application/json")));
        assert!(is_json_content_type(Some(
            "application/JSON; charset=utf-8"
        )));
        assert!(!is_json_content_type(Some("text/plain")));
        assert!(!is_json_content_type(None));
    }

    #[test]
    fn body_limit_enforced() {
        let data = [b'a'; 100];
        let ok = read_body_limited(&mut &data[..], 100).unwrap();
        assert_eq!(ok.len(), 100);

        let too_big = [b'a'; 101];
        assert!(read_body_limited(&mut &too_big[..], 100).is_err());
    }

    #[test]
    fn elide_images_writes_the_placeholder_the_frontend_writes() {
        // same input and answer as imageData.test.ts / openaiProvider.test.ts
        let png = format!("data:image/png;base64,{}", "A".repeat(40_000));
        let mut doc = json!({ "nodes": [
            { "id": "i", "data": { "shape": "image", "src": png } },
            { "id": "r", "data": { "shape": "rect", "src": "data:image/png;base64,AAAA" } },
            { "id": "e", "data": { "shape": "image" } }
        ] });
        elide_images(&mut doc);
        assert_eq!(doc["nodes"][0]["data"]["src"], "elided:image/png;29KB");
        // only images — anything else is left as it came
        assert_eq!(doc["nodes"][1]["data"]["src"], "data:image/png;base64,AAAA");
        assert!(doc["nodes"][2]["data"].get("src").is_none());
    }

    #[test]
    fn elide_images_is_for_one_canvas() {
        // a diagram is one canvas (#229 D17): no `pages` branch — such a
        // document never reaches the snapshot, and is left as it is
        let png = format!("data:image/png;base64,{}", "A".repeat(40_000));
        let mut doc = json!({ "version": 1, "title": "T", "edges": [], "nodes": [
            { "id": "i", "data": { "shape": "image", "src": png.clone() } }
        ] });
        elide_images(&mut doc);
        assert_eq!(doc["nodes"][0]["data"]["src"], "elided:image/png;29KB");
        let mut book = json!({ "version": 2, "pages": [
            { "id": "p", "nodes": [ { "id": "i", "data": { "shape": "image", "src": png.clone() } } ] }
        ] });
        elide_images(&mut book);
        assert_eq!(book["pages"][0]["nodes"][0]["data"]["src"], png);
    }

    #[test]
    fn api_info_lists_new_diagram_and_no_page_ops() {
        let info = api_info();
        let ops: Vec<&str> = info["ops"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o.as_str().unwrap())
            .collect();
        let named = |name: &str| ops.iter().any(|o| o.starts_with(&format!("{name} ")));
        assert!(named("new_diagram"), "{ops:?}");
        assert!(named("set_diagram"));
        for gone in ["add_page", "switch_page", "rename_page", "delete_page"] {
            assert!(!named(gone), "{gone} is still listed");
        }
        assert!(!info.to_string().contains("page on screen"));
    }

    #[test]
    fn inline_images_only_on_request() {
        assert!(!wants_inline_images("/api/diagram"));
        assert!(wants_inline_images("/api/diagram?images=inline"));
        assert!(wants_inline_images("/api/diagram?x=1&images=inline"));
        assert!(!wants_inline_images("/api/diagram?images=inlined"));
    }

    #[test]
    fn with_project_adds_the_field_and_keeps_null() {
        let doc = json!({ "version": 1, "nodes": [] });
        let tagged = with_project(doc.clone(), json!({ "id": "p1", "title": "T" }));
        assert_eq!(tagged["project"]["id"], "p1");
        assert_eq!(tagged["nodes"], json!([]));
        let untagged = with_project(doc, serde_json::Value::Null);
        assert!(untagged["project"].is_null());
        assert!(untagged.get("project").is_some());
    }
}
