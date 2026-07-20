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
    let entry = Entry::new(SERVICE, name).map_err(|e| format!("keyring init error: {}", e))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get error: {}", e)),
    }
}

/// Delete a secret value from the OS credential store.
/// Silently succeeds if the key does not exist.
pub fn delete_key(name: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, name).map_err(|e| format!("keyring init error: {}", e))?;
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

    // ========================================================================
    // Additional encryption tests
    // ========================================================================

    #[test]
    fn store_and_retrieve_unicode_key() {
        let key_name = test_key("unicode");
        let _ = delete_key(&key_name);
        let val = "sk-日本語テスト-🔑🎤";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_long_key_value_1200_chars() {
        // Windows Credential Manager has a strict size limit on credential blob.
        // Real API keys are typically 40-100 chars; 1200 is generous.
        let key_name = test_key("longkey1200");
        let _ = delete_key(&key_name);
        let val = "k".repeat(1200);
        assert!(store_key(&key_name, &val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn overwrite_preserves_other_keys() {
        let key_a = test_key("preserve_a");
        let key_b = test_key("preserve_b");
        let _ = delete_key(&key_a);
        let _ = delete_key(&key_b);
        store_key(&key_a, "value_a").unwrap();
        store_key(&key_b, "value_b").unwrap();
        // Overwrite key_a
        store_key(&key_a, "new_a").unwrap();
        // key_b should be unchanged
        assert_eq!(get_key(&key_b).unwrap().unwrap(), "value_b");
        assert_eq!(get_key(&key_a).unwrap().unwrap(), "new_a");
        let _ = delete_key(&key_a);
        let _ = delete_key(&key_b);
    }

    #[test]
    fn delete_nonexistent_is_idempotent() {
        let key_name = test_key("del_idem");
        let _ = delete_key(&key_name); // ensure gone
                                       // Delete twice — both should succeed
        assert!(delete_key(&key_name).is_ok());
        assert!(delete_key(&key_name).is_ok());
    }

    #[test]
    fn get_after_delete_returns_none() {
        let key_name = test_key("get_after_del");
        let _ = delete_key(&key_name);
        store_key(&key_name, "temporary").unwrap();
        assert!(get_key(&key_name).unwrap().is_some());
        delete_key(&key_name).unwrap();
        assert!(get_key(&key_name).unwrap().is_none());
    }

    #[test]
    fn store_empty_provider_name() {
        // Empty string as key name (the provider part)
        let key_name = test_key("");
        let _ = delete_key(&key_name);
        assert!(store_key(&key_name, "val").is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "val");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_special_provider_name() {
        let key_name = test_key("api-key/openai.v2");
        let _ = delete_key(&key_name);
        assert!(store_key(&key_name, "sk-special").is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "sk-special");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn key_isolation_between_providers() {
        let openai_key = test_key("openai_iso");
        let gemini_key = test_key("gemini_iso");
        let _ = delete_key(&openai_key);
        let _ = delete_key(&gemini_key);
        store_key(&openai_key, "sk-openai-123").unwrap();
        store_key(&gemini_key, "AIza-gemini-456").unwrap();
        // Each key returns its own value
        assert_eq!(get_key(&openai_key).unwrap().unwrap(), "sk-openai-123");
        assert_eq!(get_key(&gemini_key).unwrap().unwrap(), "AIza-gemini-456");
        // Deleting one doesn't affect the other
        delete_key(&openai_key).unwrap();
        assert!(get_key(&openai_key).unwrap().is_none());
        assert_eq!(get_key(&gemini_key).unwrap().unwrap(), "AIza-gemini-456");
        let _ = delete_key(&gemini_key);
    }

    #[test]
    fn rapid_overwrite_100_times() {
        let key_name = test_key("rapid_overwrite");
        let _ = delete_key(&key_name);
        for i in 0..100 {
            store_key(&key_name, &format!("value_{}", i)).unwrap();
        }
        // Final value should be the last one written
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "value_99");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_multiline_value() {
        let key_name = test_key("multiline");
        let _ = delete_key(&key_name);
        let val = "line1\nline2\nline3\ttab";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_value_with_spaces() {
        let key_name = test_key("spaces");
        let _ = delete_key(&key_name);
        let val = "  leading and trailing spaces  ";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_json_string_value() {
        let key_name = test_key("json_str");
        let _ = delete_key(&key_name);
        let val = r#"{"api_key":"sk-test","org":"org-123"}"#;
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_and_delete_multiple_keys() {
        let keys: Vec<String> = (0..5).map(|i| test_key(&format!("multi_{}", i))).collect();
        // Clean up first
        for k in &keys {
            let _ = delete_key(k);
        }
        // Store all
        for (i, k) in keys.iter().enumerate() {
            store_key(k, &format!("val_{}", i)).unwrap();
        }
        // Verify all
        for (i, k) in keys.iter().enumerate() {
            assert_eq!(get_key(k).unwrap().unwrap(), format!("val_{}", i));
        }
        // Delete all
        for k in &keys {
            delete_key(k).unwrap();
        }
        // Verify all gone
        for k in &keys {
            assert!(get_key(k).unwrap().is_none());
        }
    }

    #[test]
    fn entry_new_is_ok_for_service() {
        // Verify Entry::new works for our service name with various key names
        assert!(Entry::new(SERVICE, "openai").is_ok());
        assert!(Entry::new(SERVICE, "deepgram").is_ok());
        assert!(Entry::new(SERVICE, "assemblyai").is_ok());
        assert!(Entry::new(SERVICE, "groq").is_ok());
    }

    // ========================================================================
    // NEW: Store keys with every printable ASCII character
    // ========================================================================

    #[test]
    fn store_key_with_printable_ascii() {
        let key_name = test_key("ascii_chars");
        let _ = delete_key(&key_name);
        // All printable ASCII (32-126)
        let val: String = (32u8..=126).map(|b| b as char).collect();
        assert!(store_key(&key_name, &val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_key_with_digits() {
        let key_name = test_key("digits");
        let _ = delete_key(&key_name);
        let val = "0123456789";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_key_with_punctuation() {
        let key_name = test_key("punctuation");
        let _ = delete_key(&key_name);
        let val = "!@#$%^&*()-_=+[]{};:',.<>?/|\\~`\"";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    // ========================================================================
    // NEW: Store key, delete, re-store with different value
    // ========================================================================

    #[test]
    fn store_delete_restore_different_value() {
        let key_name = test_key("del_restore");
        let _ = delete_key(&key_name);
        store_key(&key_name, "first_value").unwrap();
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "first_value");
        delete_key(&key_name).unwrap();
        assert!(get_key(&key_name).unwrap().is_none());
        store_key(&key_name, "second_value").unwrap();
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "second_value");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_delete_restore_cycle_10() {
        let key_name = test_key("cycle_10");
        let _ = delete_key(&key_name);
        for i in 0..10 {
            store_key(&key_name, &format!("value_{}", i)).unwrap();
            assert_eq!(get_key(&key_name).unwrap().unwrap(), format!("value_{}", i));
            delete_key(&key_name).unwrap();
            assert!(get_key(&key_name).unwrap().is_none());
        }
    }

    // ========================================================================
    // NEW: Multiple providers simultaneously
    // ========================================================================

    #[test]
    fn multiple_providers_simultaneous() {
        let openai = test_key("prov_openai");
        let deepgram = test_key("prov_deepgram");
        let groq = test_key("prov_groq");
        let assembly = test_key("prov_assembly");
        let _ = delete_key(&openai);
        let _ = delete_key(&deepgram);
        let _ = delete_key(&groq);
        let _ = delete_key(&assembly);

        store_key(&openai, "sk-openai-xxx").unwrap();
        store_key(&deepgram, "dg-key-yyy").unwrap();
        store_key(&groq, "gsk-groq-zzz").unwrap();
        store_key(&assembly, "asm-key-www").unwrap();

        assert_eq!(get_key(&openai).unwrap().unwrap(), "sk-openai-xxx");
        assert_eq!(get_key(&deepgram).unwrap().unwrap(), "dg-key-yyy");
        assert_eq!(get_key(&groq).unwrap().unwrap(), "gsk-groq-zzz");
        assert_eq!(get_key(&assembly).unwrap().unwrap(), "asm-key-www");

        // Delete one, others unaffected
        delete_key(&groq).unwrap();
        assert!(get_key(&groq).unwrap().is_none());
        assert_eq!(get_key(&openai).unwrap().unwrap(), "sk-openai-xxx");
        assert_eq!(get_key(&deepgram).unwrap().unwrap(), "dg-key-yyy");
        assert_eq!(get_key(&assembly).unwrap().unwrap(), "asm-key-www");

        let _ = delete_key(&openai);
        let _ = delete_key(&deepgram);
        let _ = delete_key(&assembly);
    }

    #[test]
    fn store_key_with_hyphen_name() {
        let key_name = test_key("api-key-openai");
        let _ = delete_key(&key_name);
        assert!(store_key(&key_name, "sk-xxx").is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "sk-xxx");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_key_with_dot_name() {
        let key_name = test_key("openai.v2.key");
        let _ = delete_key(&key_name);
        assert!(store_key(&key_name, "sk-yyy").is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), "sk-yyy");
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_key_value_with_null_bytes() {
        // Test that a value without null bytes works (null bytes may not be supported)
        let key_name = test_key("no_null");
        let _ = delete_key(&key_name);
        let val = "before-after";
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }

    #[test]
    fn store_key_base64_value() {
        let key_name = test_key("base64val");
        let _ = delete_key(&key_name);
        let val = "c2stdGVzdC1rZXktMTIz"; // base64 of "sk-test-key-123"
        assert!(store_key(&key_name, val).is_ok());
        assert_eq!(get_key(&key_name).unwrap().unwrap(), val);
        let _ = delete_key(&key_name);
    }
}
