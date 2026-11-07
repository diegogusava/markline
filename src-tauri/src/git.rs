// Compare the editor buffer with HEAD without changing the index or working tree.
use std::{path::Path, process::Command};

fn git(dir: &Path, args: &[&str]) -> Option<std::process::Output> {
    Command::new("git").current_dir(dir).args(args).output().ok()
}

pub fn changes(path: &Path, text: &str) -> Option<String> {
    let path = path.canonicalize().ok()?;
    let dir = path.parent()?;
    let root = git(dir, &["rev-parse", "--show-toplevel"])?;
    if !root.status.success() { return None; }
    let root = std::path::PathBuf::from(String::from_utf8(root.stdout).ok()?.trim_end());
    let relative = path.strip_prefix(&root).ok()?.to_str()?.replace('\\', "/");
    let ignored = git(&root, &["check-ignore", "--", &relative])?;
    if ignored.status.success() { return None; }
    let base = git(&root, &["show", &format!("HEAD:{}", relative)])?;
    if !base.status.success() {
        // A file missing from HEAD is new. Other Git failures must not mark it as new.
        let head = git(&root, &["rev-parse", "--verify", "HEAD"])?;
        if head.status.success() {
            let entry = git(&root, &["ls-tree", "HEAD", "--", &relative])?;
            if !entry.status.success() || !entry.stdout.is_empty() { return None; }
        }
    }
    let mut random = [0u8; 16];
    getrandom::getrandom(&mut random).ok()?;
    let temp = std::env::temp_dir().join(format!("markline-git-{:x}", u128::from_le_bytes(random)));
    std::fs::create_dir(&temp).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o700)).is_err() {
            let _ = std::fs::remove_dir(&temp);
            return None;
        }
    }
    let result = (|| {
        std::fs::write(temp.join("base"), if base.status.success() { &base.stdout[..] } else { b"" }).ok()?;
        std::fs::write(temp.join("current"), text).ok()?;
        let diff = git(&temp, &["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--text", "--unified=0", "--", "base", "current"])?;
        if !matches!(diff.status.code(), Some(0 | 1)) { return None; }
        // Return only hunk headers; file content stays out of the response.
        Some(String::from_utf8(diff.stdout).ok()?.lines().filter(|l| l.starts_with("@@ ")).collect::<Vec<_>>().join("\n"))
    })();
    let _ = std::fs::remove_dir_all(temp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_buffer_with_head_and_handles_new_ignored_and_non_repo_files() {
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).unwrap();
        let dir = std::env::temp_dir().join(format!("markline-test-{:x}", u128::from_le_bytes(nonce)));
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("a.md");
        std::fs::write(&file, "one\ntwo\nthree\n").unwrap();
        assert_eq!(changes(&file, "new\n"), None);
        assert!(git(&dir, &["init", "--quiet"]).unwrap().status.success());
        assert!(changes(&file, "new\n").unwrap().contains("@@ -0,0 +1 @@"));
        git(&dir, &["add", "--", "a.md"]);
        assert!(git(&dir, &["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-qm", "Initial"]).unwrap().status.success());
        assert_eq!(changes(&file, "one\ntwo\nthree\n"), Some(String::new()));
        assert!(changes(&file, "one\nchanged\nthree\n").unwrap().contains("@@ -2 +2 @@"));
        assert!(changes(&file, "one\nthree\n").unwrap().contains("@@ -2 +1,0 @@"));
        std::fs::write(dir.join(".gitignore"), "ignored.md\n").unwrap();
        let ignored = dir.join("ignored.md");
        std::fs::write(&ignored, "private\n").unwrap();
        assert_eq!(changes(&ignored, "private\n"), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
