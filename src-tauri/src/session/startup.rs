//! One startup command per interactive shell, owned by that shell's input loop.
//! No detached timer can send into a replacement session after a reconnect.

use std::time::Duration;

use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::Instant;

use super::{encoding, SessionCommand};
use crate::model::{SessionKind, SessionProfile};

pub struct StartupCommand {
    bytes: Option<Vec<u8>>,
    delay: Duration,
    deadline: Option<Instant>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use tokio::time::{advance, timeout};

    fn profile(command: &str) -> SessionProfile {
        let mut profile = crate::tests::profile(SessionKind::Ssh);
        profile.startup_command = Some(command.into());
        profile
    }

    fn written(command: Option<SessionCommand>) -> Vec<u8> {
        match command {
            Some(SessionCommand::Write(bytes)) => bytes,
            _ => panic!("expected startup text"),
        }
    }

    #[test]
    fn multiline_input_preserves_script_whitespace_and_submits_the_last_line() {
        let startup = StartupCommand::new(&profile("cat <<'END'\r\n  hello\n\nEND\rpwd"));
        assert_eq!(
            startup.bytes.unwrap(),
            b"cat <<'END'\r  hello\r\rEND\rpwd\r"
        );
        let startup = StartupCommand::new(&profile("pwd\r\n"));
        assert_eq!(startup.bytes.unwrap(), b"pwd\r");
        let mut profile = profile("echo 你好");
        profile.encoding = Some("gbk".into());
        assert_eq!(
            StartupCommand::new(&profile).bytes.unwrap(),
            b"echo \xc4\xe3\xba\xc3\r"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn waits_for_shell_readiness_then_delay_without_blocking_normal_input() {
        let mut startup = StartupCommand::new(&profile("pwd"));
        let (tx, mut rx) = mpsc::unbounded_channel();
        assert!(timeout(Duration::from_secs(10), startup.recv(&mut rx))
            .await
            .is_err());
        startup.start();
        let started = Instant::now();
        advance(Duration::from_millis(200)).await;
        startup.start(); // does not postpone the original deadline
        tx.send(SessionCommand::Resize {
            cols: 100,
            rows: 30,
        })
        .unwrap();
        assert!(matches!(
            startup.recv(&mut rx).await,
            Some(SessionCommand::Resize { .. })
        ));
        tx.send(SessionCommand::Write(b"input".to_vec())).unwrap();
        assert_eq!(written(startup.recv(&mut rx).await), b"input");
        assert_eq!(written(startup.recv(&mut rx).await), b"pwd\r");
        assert_eq!(Instant::now() - started, Duration::from_millis(500));
        startup.start(); // no second execution, even if asked to start again
        assert!(timeout(Duration::from_secs(1), startup.recv(&mut rx))
            .await
            .is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn output_cancelling_the_receive_future_neither_loses_nor_delays_the_command() {
        let mut startup = StartupCommand::new(&profile("pwd"));
        let (_tx, mut rx) = mpsc::unbounded_channel();
        startup.start();
        let started = Instant::now();
        assert!(timeout(Duration::from_millis(100), startup.recv(&mut rx))
            .await
            .is_err());
        assert_eq!(written(startup.recv(&mut rx).await), b"pwd\r");
        assert_eq!(Instant::now() - started, Duration::from_millis(500));
    }

    #[tokio::test(start_paused = true)]
    async fn close_or_dropped_sender_cancels_even_an_overdue_command() {
        for close in [true, false] {
            let mut startup = StartupCommand::new(&profile("pwd"));
            let (tx, mut rx) = mpsc::unbounded_channel();
            startup.start();
            advance(Duration::from_secs(1)).await;
            if close {
                tx.send(SessionCommand::Close).unwrap();
                assert!(matches!(
                    startup.recv(&mut rx).await,
                    Some(SessionCommand::Close)
                ));
                assert!(timeout(Duration::from_secs(1), startup.recv(&mut rx))
                    .await
                    .is_err());
            } else {
                drop(tx);
                assert!(startup.recv(&mut rx).await.is_none());
            }
            assert!(startup.bytes.is_none());
        }
    }

    #[tokio::test(start_paused = true)]
    async fn each_new_shell_gets_its_own_execution_including_zero_delay() {
        let mut profile = profile("pwd");
        profile.startup_delay_ms = Some(0);
        for kind in [SessionKind::Ssh, SessionKind::Local] {
            profile.kind = kind;
            for _ in 0..2 {
                let mut startup = StartupCommand::new(&profile);
                let (_tx, mut rx) = mpsc::unbounded_channel();
                startup.start();
                let started = Instant::now();
                assert_eq!(written(startup.recv(&mut rx).await), b"pwd\r");
                assert_eq!(Instant::now(), started);
                assert!(timeout(Duration::from_secs(1), startup.recv(&mut rx))
                    .await
                    .is_err());
            }
        }
    }

    #[test]
    fn empty_commands_and_non_shell_protocols_are_disabled() {
        for command in ["", "  \r\n\t"] {
            assert!(StartupCommand::new(&profile(command)).bytes.is_none());
        }
        for kind in [
            SessionKind::Telnet,
            SessionKind::Sftp,
            SessionKind::Ftp,
            SessionKind::Serial,
        ] {
            let mut profile = profile("must not run");
            profile.kind = kind;
            let mut startup = StartupCommand::new(&profile);
            startup.start();
            assert!(startup.bytes.is_none());
            assert!(startup.deadline.is_none());
        }
    }
}

impl StartupCommand {
    pub fn new(profile: &SessionProfile) -> Self {
        let bytes = profile
            .startup_command
            .as_deref()
            .filter(|text| {
                matches!(profile.kind, SessionKind::Local | SessionKind::Ssh)
                    && !text.trim().is_empty()
            })
            .map(|text| {
                // Treat LF, CRLF and CR as Enter without doubling CRLF.
                // Preserve whitespace within scripts, including heredocs.
                let mut text = text.replace("\r\n", "\n").replace('\n', "\r");
                if !text.ends_with('\r') {
                    text.push('\r');
                }
                encoding::encode_input(encoding::terminal_encoding(profile), &text)
            });
        Self {
            bytes,
            delay: Duration::from_millis(profile.startup_delay_ms.unwrap_or(500) as u64),
            deadline: None,
        }
    }

    /// Local: after spawning the PTY child. SSH: after the server accepts
    /// both PTY and shell requests. Starting twice never resets the timer.
    pub fn start(&mut self) {
        if self.bytes.is_some() && self.deadline.is_none() {
            self.deadline = Some(Instant::now() + self.delay);
        }
    }

    /// Cancellation-safe: output and resize events cannot reset the deadline
    /// or consume the startup command. A queued close takes priority even
    /// when the timer is already due. Normal input remains usable meanwhile.
    pub async fn recv(
        &mut self,
        rx: &mut UnboundedReceiver<SessionCommand>,
    ) -> Option<SessionCommand> {
        let command = if let Some(deadline) = self.deadline {
            tokio::select! {
                biased;
                command = rx.recv() => command,
                _ = tokio::time::sleep_until(deadline) => {
                    self.deadline = None;
                    self.bytes.take().map(SessionCommand::Write)
                }
            }
        } else {
            rx.recv().await
        };
        if matches!(command, None | Some(SessionCommand::Close)) {
            self.bytes = None;
            self.deadline = None;
        }
        command
    }
}
