//! The AI API keys, kept in the OS credential store (#17).
//!
//! They used to live in `localStorage` — a plain-text file in the webview's
//! data directory, readable by anything running as the user. The platform
//! store encrypts them at rest and scopes them to this user: Keychain on
//! macOS, Credential Manager on Windows, the Secret Service on Linux.
//!
//! **Only named secrets.** The webview names what it wants, and a name is not
//! a path into the user's whole keychain: anything outside [`SECRET_NAMES`] is
//! refused before the store is touched, so a compromised page cannot read the
//! user's other credentials through this command.

use keyring::{Entry, Error};

/// The service every entry is filed under — the bundle identifier, so the
/// entries are recognisably this app's in Keychain Access.
const SERVICE: &str = "app.dosik.desktop";

/// Every secret this app keeps. One per AI vendor (`settings.ts`, `AiVendor`).
pub const SECRET_NAMES: [&str; 2] = ["ai-key-claude", "ai-key-openai"];

fn check(name: &str) -> Result<(), String> {
    if SECRET_NAMES.contains(&name) {
        Ok(())
    } else {
        Err(format!("unknown secret: {name}"))
    }
}

/// A store that cannot be reached says so plainly — the frontend keeps the
/// key in memory for the session and tells the user it was not saved.
fn describe(error: Error) -> String {
    match error {
        // `Entry::new` drops the real cause and keeps it in `store_status` —
        // say it, so a Linux user can tell a locked keyring from a missing
        // Secret Service (#153)
        Error::NoDefaultStore => match Entry::store_status() {
            Err(cause) => format!("the system credential store is not available: {cause}"),
            Ok(()) => "the system credential store is not available".to_string(),
        },
        other => other.to_string(),
    }
}

fn get_from(service: &str, name: &str) -> Result<Option<String>, String> {
    match Entry::new(service, name).map_err(describe)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(describe(error)),
    }
}

fn set_in(service: &str, name: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(service, name).map_err(describe)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(error)),
        };
    }
    entry.set_password(value).map_err(describe)
}

/// Runs a store call off the main thread. A synchronous command runs on it,
/// and the store can block — an unlock prompt on Linux, macOS asking whether
/// this build may read the item — which would freeze the window for as long
/// (#153). The call itself is blocking, so it gets a blocking thread.
async fn off_main<T: Send + 'static>(
    call: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(call)
        .await
        .map_err(|error| format!("credential store call failed: {error}"))?
}

/// `None` when nothing is stored — a missing key is a normal state, not an error.
#[tauri::command]
pub async fn secret_get(name: String) -> Result<Option<String>, String> {
    check(&name)?;
    off_main(move || get_from(SERVICE, &name)).await
}

/// An empty value deletes: clearing the field is how the user removes a key.
#[tauri::command]
pub async fn secret_set(name: String, value: String) -> Result<(), String> {
    check(&name)?;
    off_main(move || set_in(SERVICE, &name, &value)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The service is the bundle identifier, written out a second time here —
    /// so a change to one without the other is caught.
    #[test]
    fn the_service_is_the_bundle_identifier() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        assert_eq!(conf["identifier"].as_str(), Some(SERVICE));
    }

    #[test]
    fn names_outside_the_list_never_reach_the_store() {
        for name in ["", "ai-key-", "ai-key-gemini", "../ai-key-claude", "login"] {
            let refused = check(name).err().unwrap_or_default();
            assert!(refused.starts_with("unknown secret"), "{name}: {refused}");
        }
        for name in SECRET_NAMES {
            assert!(check(name).is_ok());
        }
    }

    #[test]
    fn get_and_set_refuse_unknown_names_too() {
        tauri::async_runtime::block_on(async {
            assert!(secret_get("other".into()).await.is_err());
            assert!(secret_set("other".into(), "x".into()).await.is_err());
        });
    }

    /// Talks to the real store under a test-only service, so the user's own
    /// entries are never touched. Runs only on request:
    /// `cargo test --no-default-features -- --ignored real_store`
    #[test]
    #[ignore]
    fn real_store_round_trip() {
        let service = "app.dosik.desktop.test";
        let name = "ai-key-claude";
        set_in(service, name, "sk-dosik-test").expect("store reachable");
        assert_eq!(
            get_from(service, name).unwrap().as_deref(),
            Some("sk-dosik-test")
        );
        set_in(service, name, "sk-dosik-test-2").unwrap();
        assert_eq!(
            get_from(service, name).unwrap().as_deref(),
            Some("sk-dosik-test-2")
        );
        set_in(service, name, "").unwrap();
        assert_eq!(get_from(service, name).unwrap(), None);
        // deleting what is not there is not an error either
        set_in(service, name, "").unwrap();
    }
}
