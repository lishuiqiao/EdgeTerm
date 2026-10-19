//! Portable password-encrypted backups. Secrets never appear in IPC previews.
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ring::{
    aead, digest, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, Result};
use crate::model::{AppData, DataSummary, APP_DATA_APP};
use crate::store::{is_data_file_path, redact_profile, validate_app_data, Store};

// The envelope is a newer format so older builds reject it, rather than
// silently treating it as an empty plain export. The inner layout stays v3.
const ENCRYPTED_FORMAT: u32 = 4;
const ITERATIONS: u32 = 600_000;
const MAX_FILE_SIZE: usize = 32 * 1024 * 1024;
const AAD: &[u8] = b"EdgeTerm backup v4: pbkdf2-sha256/600000/chacha20-poly1305";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    app: String,
    format: u32,
    encrypted: bool,
    kdf: String,
    iterations: u32,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub encrypted: bool,
    /// None until the user supplies the export password. Always redacted.
    pub data: Option<AppData>,
    /// Binds confirmation to the exact bytes previewed, not just a file path.
    pub fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub summary: DataSummary,
    pub settings: Option<serde_json::Value>,
}

fn check_path(path: &Path) -> Result<()> {
    if !is_data_file_path(path) {
        return Err(AppError::new(
            "not an EdgeTerm data file: expected a .edgeterm file",
        ));
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<Vec<u8>> {
    check_path(path)?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take((MAX_FILE_SIZE + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_FILE_SIZE {
        return Err(AppError::new("EdgeTerm data file exceeds the 32 MiB limit"));
    }
    Ok(bytes)
}

fn fingerprint(bytes: &[u8]) -> String {
    B64.encode(digest::digest(&digest::SHA256, bytes).as_ref())
}

fn envelope(bytes: &[u8]) -> Result<Option<Envelope>> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| AppError::new("not a valid EdgeTerm data file"))?;
    if value.get("encrypted").is_none() {
        return Ok(None);
    }
    let envelope: Envelope = serde_json::from_value(value)
        .map_err(|_| AppError::new("invalid encrypted backup header"))?;
    if envelope.app != APP_DATA_APP
        || envelope.format != ENCRYPTED_FORMAT
        || !envelope.encrypted
        || envelope.kdf != "pbkdf2-sha256"
        || envelope.iterations != ITERATIONS
        || envelope.cipher != "chacha20-poly1305"
    {
        return Err(AppError::new("unsupported encrypted backup format"));
    }
    Ok(Some(envelope))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<aead::LessSafeKey> {
    if password.is_empty() || password.len() > 1024 {
        return Err(AppError::new(
            "Enter an export password of at most 1024 UTF-8 bytes",
        ));
    }
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(ITERATIONS).unwrap(),
        salt,
        password.as_bytes(),
        key.as_mut(),
    );
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::CHACHA20_POLY1305, key.as_ref())
            .map_err(|_| AppError::new("invalid backup encryption key"))?,
    ))
}

fn encrypt(data: &AppData, password: &str) -> Result<Vec<u8>> {
    if password.chars().count() < 8 || password.trim().is_empty() {
        return Err(AppError::new(
            "Use an export password of at least 8 characters",
        ));
    }
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    let rng = SystemRandom::new();
    rng.fill(&mut salt)
        .and_then(|_| rng.fill(&mut nonce))
        .map_err(|_| AppError::new("random number generator unavailable"))?;
    let key = derive_key(password, &salt)?;
    let mut bytes = Zeroizing::new(serde_json::to_vec(data)?);
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(AAD),
        &mut *bytes,
    )
    .map_err(|_| AppError::new("failed to encrypt backup"))?;
    Ok(serde_json::to_vec_pretty(&Envelope {
        app: APP_DATA_APP.into(),
        format: ENCRYPTED_FORMAT,
        encrypted: true,
        kdf: "pbkdf2-sha256".into(),
        iterations: ITERATIONS,
        cipher: "chacha20-poly1305".into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(&*bytes),
    })?)
}

fn decrypt(envelope: Envelope, password: &str) -> Result<AppData> {
    let invalid = || AppError::new("invalid encrypted backup data");
    let salt: [u8; 16] = B64
        .decode(envelope.salt)
        .map_err(|_| invalid())?
        .try_into()
        .map_err(|_| invalid())?;
    let nonce: [u8; 12] = B64
        .decode(envelope.nonce)
        .map_err(|_| invalid())?
        .try_into()
        .map_err(|_| invalid())?;
    let mut bytes = Zeroizing::new(B64.decode(envelope.ciphertext).map_err(|_| invalid())?);
    let key = derive_key(password, &salt)?;
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(AAD),
            &mut bytes,
        )
        .map_err(|_| AppError::new("Incorrect export password or damaged backup file"))?;
    let data: AppData = serde_json::from_slice(plaintext).map_err(|_| invalid())?;
    validate_app_data(&data)?;
    Ok(data)
}

fn plain_data(bytes: &[u8]) -> Result<AppData> {
    let mut data: AppData = serde_json::from_slice(bytes)
        .map_err(|_| AppError::new("not a valid EdgeTerm data file"))?;
    validate_app_data(&data)?;
    data.profiles = data.profiles.into_iter().map(redact_profile).collect();
    data.ai = data.ai.map(|ai| ai.redacted());
    Ok(data)
}

pub fn preview(path: &Path, password: Option<&str>) -> Result<BackupPreview> {
    let bytes = read_file(path)?;
    let (encrypted, data) = match envelope(&bytes)? {
        Some(envelope) => (true, password.map(|p| decrypt(envelope, p)).transpose()?),
        None => (false, Some(plain_data(&bytes)?)),
    };
    let data = data.map(|mut data| {
        data.profiles = data.profiles.into_iter().map(redact_profile).collect();
    data.ai = data.ai.map(|ai| ai.redacted());
        data
    });
    Ok(BackupPreview {
        encrypted,
        data,
        fingerprint: fingerprint(&bytes),
    })
}

pub fn export(
    store: &Store,
    path: &Path,
    settings: serde_json::Value,
    exported_at: String,
    password: Option<&str>,
) -> Result<DataSummary> {
    check_path(path)?;
    let mut data = if password.is_some() {
        store.snapshot_with_credentials()
    } else {
        store.snapshot()
    };
    data.settings = Some(settings);
    data.exported_at = Some(exported_at);
    let summary = DataSummary {
        profiles: data.profiles.len(),
        groups: data.groups.len(),
        sender_commands: data.sender_commands.len(),
        skipped_sender_commands: 0,
    };
    let encoded = match password {
        Some(password) => encrypt(&data, password),
        None => serde_json::to_vec_pretty(&data).map_err(AppError::from),
    };
    // Wipe credential strings after serialization, even if encryption failed.
    data.profiles = data.profiles.into_iter().map(redact_profile).collect();
    data.ai = data.ai.map(|ai| ai.redacted());
    let bytes = encoded?;
    if bytes.len() > MAX_FILE_SIZE {
        return Err(AppError::new("EdgeTerm data file exceeds the 32 MiB limit"));
    }
    // Never truncate an existing backup until the complete replacement exists.
    let temporary = path.with_file_name(format!(".edgeterm-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    Ok(summary)
}

pub fn import(
    store: &Store,
    path: &Path,
    password: Option<&str>,
    expected: &str,
) -> Result<ImportResult> {
    let bytes = read_file(path)?;
    if fingerprint(&bytes) != expected {
        return Err(AppError::new(
            "Backup file changed after preview; reopen it before importing",
        ));
    }
    let (data, encrypted) = match envelope(&bytes)? {
        Some(envelope) => (
            decrypt(
                envelope,
                password.ok_or_else(|| AppError::new("Enter the export password"))?,
            )?,
            true,
        ),
        None => (plain_data(&bytes)?, false),
    };
    let settings = data.settings.clone();
    let summary = if encrypted {
        store.import_with_credentials(data)?
    } else {
        store.import_data(data)?
    };
    Ok(ImportResult { summary, settings })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SessionProfile;
    use serde_json::json;

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("edgeterm-backup-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn store(&self, name: &str) -> Store {
            Store::load_from(self.0.join(name).join("sessions.json"))
        }
        fn path(&self) -> std::path::PathBuf {
            self.0.join("backup.edgeterm")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn profile(id: &str, auth: &str) -> SessionProfile {
        serde_json::from_value(json!({
            "id": id, "name": "private server", "kind": "ssh", "auth": auth,
            "host": "private.example", "startupCommand": "echo hello\npwd",
            "startupDelayMs": 1200,
        }))
        .unwrap()
    }

    #[test]
    fn encrypted_backup_restores_passwords_and_settings_without_exposing_them_in_preview() {
        let fixture = Fixture::new();
        let source = fixture.store("source");
        let target = fixture.store("target");
        let mut p = profile("login", "password");
        p.password = Some("login secret".into());
        source.save(p).unwrap();
        let mut p = profile("key", "publicKey");
        p.passphrase = Some("private key secret".into());
        p.private_key_path = Some("/keys/id_ed25519".into());
        source.save(p).unwrap();
        // A missing credential in the incoming backup must not erase a local one.
        source.save(profile("keep", "password")).unwrap();
        for id in ["login", "keep", "unrelated"] {
            let mut p = profile(id, "password");
            p.password = Some("local secret".into());
            target.save(p).unwrap();
        }
        let password = "备份密码 🔑 with spaces ";
        export(
            &source,
            &fixture.path(),
            json!({"theme":"light"}),
            "today".into(),
            Some(password),
        )
        .unwrap();
        let raw = std::fs::read_to_string(fixture.path()).unwrap();
        for secret in [
            "login secret",
            "private key secret",
            "private.example",
            "theme",
            "echo hello",
        ] {
            assert!(!raw.contains(secret));
        }
        assert!(crate::commands::read_app_data(fixture.path().display().to_string()).is_err());
        let locked = preview(&fixture.path(), None).unwrap();
        assert!(locked.encrypted && locked.data.is_none());
        let unlocked = preview(&fixture.path(), Some(password)).unwrap();
        for p in &unlocked.data.as_ref().unwrap().profiles {
            assert!(p.password.is_none() && p.passphrase.is_none());
        }
        let before = serde_json::to_value(target.snapshot()).unwrap();
        assert!(import(
            &target,
            &fixture.path(),
            Some("wrong password"),
            &unlocked.fingerprint
        )
        .is_err());
        assert_eq!(serde_json::to_value(target.snapshot()).unwrap(), before);
        assert_eq!(
            target.get("login").unwrap().unwrap().password.as_deref(),
            Some("local secret")
        );
        let result = import(
            &target,
            &fixture.path(),
            Some(password),
            &unlocked.fingerprint,
        )
        .unwrap();
        assert_eq!(result.summary.profiles, 3);
        assert_eq!(result.settings, Some(json!({"theme":"light"})));
        let reloaded = fixture.store("target");
        assert_eq!(reloaded.list().len(), 4);
        let login = reloaded.get("login").unwrap().unwrap();
        assert_eq!(login.password.as_deref(), Some("login secret"));
        assert_eq!(login.startup_delay_ms, Some(1200));
        assert_eq!(login.startup_command.as_deref(), Some("echo hello\npwd"));
        let key = reloaded.get("key").unwrap().unwrap();
        assert_eq!(key.passphrase.as_deref(), Some("private key secret"));
        assert_eq!(key.private_key_path.as_deref(), Some("/keys/id_ed25519"));
        assert_eq!(
            reloaded.get("keep").unwrap().unwrap().password.as_deref(),
            Some("local secret")
        );
        assert!(reloaded
            .list()
            .iter()
            .all(|p| p.password.is_none() && p.passphrase.is_none()));
        let stored = std::fs::read_to_string(fixture.0.join("target/credentials.json")).unwrap();
        assert!(!stored.contains("login secret"));
        assert!(!stored.contains("private key secret"));
        let source_vault: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(fixture.0.join("source/credentials.json")).unwrap(),
        )
        .unwrap();
        let target_vault: serde_json::Value = serde_json::from_str(&stored).unwrap();
        assert_ne!(source_vault["salt"], target_vault["salt"]);
    }

    #[test]
    fn plain_backups_remain_compatible_and_cannot_import_credentials() {
        let fixture = Fixture::new();
        let source = fixture.store("source");
        let mut p = profile("login", "password");
        p.password = Some("original secret".into());
        source.save(p).unwrap();
        export(&source, &fixture.path(), json!({}), "today".into(), None).unwrap();
        let raw = std::fs::read_to_string(fixture.path()).unwrap();
        assert!(!raw.contains("original secret"));
        assert_eq!(
            crate::commands::read_app_data(fixture.path().display().to_string())
                .unwrap()
                .profiles
                .len(),
            1
        );
        let mut data: serde_json::Value = serde_json::from_str(&raw).unwrap();
        data["profiles"][0]["password"] = json!("smuggled secret");
        for format in 1..=3 {
            data["format"] = json!(format);
            std::fs::write(fixture.path(), serde_json::to_vec(&data).unwrap()).unwrap();
            let preview = preview(&fixture.path(), None).unwrap();
            assert!(!preview.encrypted);
            assert!(preview.data.unwrap().profiles[0].password.is_none());
            import(&source, &fixture.path(), None, &preview.fingerprint).unwrap();
            assert_eq!(
                source.get("login").unwrap().unwrap().password.as_deref(),
                Some("original secret")
            );
        }
    }

    #[test]
    fn changed_file_requires_another_preview() {
        let fixture = Fixture::new();
        let store = fixture.store("target");
        export(&store, &fixture.path(), json!({}), "today".into(), None).unwrap();
        let preview = preview(&fixture.path(), None).unwrap();
        export(
            &store,
            &fixture.path(),
            json!({"theme":"light"}),
            "later".into(),
            None,
        )
        .unwrap();
        assert!(import(&store, &fixture.path(), None, &preview.fingerprint)
            .err()
            .unwrap()
            .to_string()
            .contains("changed"));
        assert!(store.list().is_empty());
    }

    #[test]
    fn encryption_uses_fresh_randomness_and_authenticates_ciphertext_and_header() {
        let fixture = Fixture::new();
        let data = fixture.store("source").snapshot();
        let password = "long test password";
        let first = encrypt(&data, password).unwrap();
        let second = encrypt(&data, password).unwrap();
        let first_json: serde_json::Value = serde_json::from_slice(&first).unwrap();
        let second_json: serde_json::Value = serde_json::from_slice(&second).unwrap();
        for field in ["salt", "nonce", "ciphertext"] {
            assert_ne!(first_json[field], second_json[field]);
        }
        for field in ["salt", "nonce", "ciphertext"] {
            let mut damaged = first_json.clone();
            let mut bytes = B64.decode(damaged[field].as_str().unwrap()).unwrap();
            bytes[0] ^= 1;
            damaged[field] = json!(B64.encode(bytes));
            let bytes = serde_json::to_vec(&damaged).unwrap();
            assert!(decrypt(envelope(&bytes).unwrap().unwrap(), password).is_err());
        }
        for (field, value) in [
            ("iterations", json!(u32::MAX)),
            ("format", json!(99)),
            ("kdf", json!("none")),
            ("cipher", json!("none")),
            ("encrypted", json!(false)),
            ("app", json!("Other")),
        ] {
            let mut damaged = first_json.clone();
            damaged[field] = value;
            assert!(envelope(&serde_json::to_vec(&damaged).unwrap()).is_err());
        }
        let mut damaged = first_json.clone();
        damaged["salt"] = json!(B64.encode([1u8]));
        assert!(decrypt(
            envelope(&serde_json::to_vec(&damaged).unwrap())
                .unwrap()
                .unwrap(),
            password
        )
        .is_err());
    }

    #[test]
    fn invalid_password_does_not_overwrite_an_existing_backup() {
        let fixture = Fixture::new();
        let store = fixture.store("source");
        export(&store, &fixture.path(), json!({}), "today".into(), None).unwrap();
        let original = std::fs::read(fixture.path()).unwrap();
        for password in ["", "short", "        "] {
            assert!(export(
                &store,
                &fixture.path(),
                json!({}),
                "today".into(),
                Some(password)
            )
            .is_err());
            assert_eq!(std::fs::read(fixture.path()).unwrap(), original);
        }
        assert!(encrypt(&store.snapshot(), &"x".repeat(1025)).is_err());
    }

    #[test]
    fn malformed_and_oversized_files_are_refused() {
        let fixture = Fixture::new();
        for bytes in [
            b"not json".as_slice(),
            br#"{"app":"Other","format":3}"#,
            br#"{"app":"EdgeTerm","format":4}"#,
            br#"{"encrypted":true}"#,
        ] {
            std::fs::write(fixture.path(), bytes).unwrap();
            assert!(preview(&fixture.path(), None).is_err());
        }
        let file = std::fs::File::create(fixture.path()).unwrap();
        file.set_len((MAX_FILE_SIZE + 1) as u64).unwrap();
        assert!(preview(&fixture.path(), None).is_err());
        assert!(preview(&fixture.0.join("backup.json"), None).is_err());
    }
}
