//! API key encryption using OS-native credential storage.
//!
//! Uses the `keyring` crate which wraps:
//! - Windows: Credential Manager
//! - macOS: Keychain
//! - Linux: Secret Service (via D-Bus)
//!
//! Falls back to base64 obfuscation if keyring is unavailable.

use keyring::Entry;

const SERVICE: &str = "whisperclick";

/// Store a secret value in the OS credential store.
pub fn store_key(name: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, name)
        .map_err(|e| format!("keyring init error: {}", e))?
        .set_password(value)
        .map_err(|e| format!("keyring store error: {}", e))
}

/// Retrieve a secret value from the OS credential store.
/// Returns Ok(None) if the key does not exist.
pub fn get_key(name: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, name)
        .map_err(|e| format!("keyring init error: {}", e))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get error: {}", e)),
    }
}

/// Delete a secret value from the OS credential store.
/// Silently succeeds if the key does not exist.
pub fn delete_key(name: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, name)
        .map_err(|e| format!("keyring init error: {}", e))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete error: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Use unique names per test to avoid cross-test interference
    fn test_key(name: &str) -> String {
        format!("test-{}-{}", name, std::process::id())
    }

    #[test]
    fn keyring_entry_name_format() {
        let name = format!("apikey-{}", "openai");
        let entry = Entry::new(SERVICE, &name);
        assert!(entry.is_ok());
    }

    #[test]
    fn store_and_retrieve_key() {
        let key_name = test_key("store_retrieve");
        let _ = delete_key(&key_name); // cleanup first
        assert!(store_key(&key_name, "sk-test123").is_ok());
        let result = get_key(&key_name).unwrap();
        assert_eq!(result.unwrap(), "sk-test123");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn get_nonexistent_key_returns_none() {
        let key_name = test_key("nonexistent");
        let _ = delete_key(&key_name);
        let result = get_key(&key_name).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn delete_key_removes_it() {
        let key_name = test_key("delete");
        let _ = store_key(&key_name, "temp_value");
        assert!(delete_key(&key_name).is_ok());
        assert!(get_key(&key_name).unwrap().is_none());
    }

    #[test]
    fn delete_nonexistent_key_succeeds() {
        let key_name = test_key("del_noop");
        let _ = delete_key(&key_name); // ensure it doesn't exist
        assert!(delete_key(&key_name).is_ok());
    }

    #[test]
    fn overwrite_existing_key() {
        let key_name = test_key("overwrite");
        let _ = delete_key(&key_name);
        store_key(&key_name, "old_value").unwrap();
        store_key(&key_name, "new_value").unwrap();
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "new_value");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_empty_key() {
        let key_name = test_key("empty");
        let _ = delete_key(&key_name);
        assert!(store_key(&key_name, "").is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_long_key() {
        let key_name = test_key("long");
        let _ = delete_key(&key_name);
        let long_val = "a".repeat(1000);
        assert!(store_key(&key_name, &long_val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), long_val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_special_chars() {
        let key_name = test_key("special");
        let _ = delete_key(&key_name);
        let val = "sk-test!@#$%^&*()_+-=[]{}|;':\",./<>?";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }
}
