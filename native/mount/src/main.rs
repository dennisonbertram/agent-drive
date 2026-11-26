use agent_drive_mount::{Bridge, DriveFs, check_mountpoint};
use fuser::{Config, MountOption};
use std::{
    io::{BufReader, BufWriter},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI32, Ordering},
    },
    thread,
    time::Duration,
};

static SHUTDOWN_SIGNAL: AtomicI32 = AtomicI32::new(0);
static OWNED_MOUNT_UNMOUNTED: AtomicBool = AtomicBool::new(false);

extern "C" fn record_shutdown_signal(signal: libc::c_int) {
    SHUTDOWN_SIGNAL.store(signal, Ordering::Relaxed);
}

fn main() {
    if let Err(error) = run() {
        eprintln!("agent-drive-mount: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    let parent_pid = {
        let parent = unsafe { libc::getppid() };
        if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if unsafe { libc::getppid() } != parent {
            return Err("bridge parent exited during startup".into());
        }
        parent
    };
    #[cfg(not(target_os = "linux"))]
    let parent_pid = 0;
    let mut args = std::env::args_os().skip(1);
    let mount_arg = args.next().ok_or("usage: agent-drive-mount <mountpoint>")?;
    let mut read_write = false;
    for arg in args {
        if arg == "--read-write" && !read_write {
            read_write = true;
        } else {
            return Err("usage: agent-drive-mount <mountpoint> [--read-write]".into());
        }
    }
    let mountpoint = PathBuf::from(mount_arg);
    let uid = unsafe { libc::geteuid() };
    let gid = unsafe { libc::getegid() };
    let mountpoint = check_mountpoint(&mountpoint, uid)?;
    let mut bridge = Bridge::new(
        BufReader::new(std::io::stdin()),
        BufWriter::new(std::io::stdout()),
    );
    let capabilities = bridge.capabilities()?;
    if read_write
        && (capabilities.read_only
            || !capabilities.write
            || ![
                "openWrite",
                "write",
                "truncate",
                "readStaged",
                "flush",
                "release",
            ]
            .iter()
            .all(|operation| capabilities.supports(operation)))
    {
        return Err("the drive key does not allow the required write operations".into());
    }
    let fs = DriveFs::with_capabilities(bridge, uid, gid, capabilities, read_write);
    let activity = fs.mount_activity();
    let mut config = Config::default();
    config.mount_options = vec![MountOption::FSName("agent-drive".into())];
    if !read_write {
        config.mount_options.push(MountOption::RO);
    }
    config.mount_options.extend([
        MountOption::NoDev,
        MountOption::NoSuid,
        MountOption::NoExec,
        MountOption::DefaultPermissions,
    ]);
    install_shutdown_handlers()?;
    let session = fuser::Session::new(fs, &mountpoint, &config)?;
    let mount_id = owned_mount_id(&mountpoint)?;
    let finished = Arc::new(AtomicBool::new(false));
    let watcher_finished = finished.clone();
    let watcher_mountpoint = mountpoint.clone();
    let watcher_parent_pid = parent_pid;
    let watcher = thread::Builder::new()
        .name("agent-drive-unmount".into())
        .spawn(move || {
            while !watcher_finished.load(Ordering::Acquire) {
                if bridge_parent_exited(watcher_parent_pid) {
                    exit_after_parent_exit(&watcher_mountpoint, mount_id);
                }
                if SHUTDOWN_SIGNAL.load(Ordering::Acquire) != 0 {
                    let (open_files, open_directories) = activity.open_handle_counts();
                    if open_files != 0 || open_directories != 0 {
                        eprintln!(
                            "agent-drive-mount: waiting for {open_files} open file and {open_directories} open directory handles to close before unmount; staged changes remain available"
                        );
                    }
                    while !activity.is_idle() && !watcher_finished.load(Ordering::Acquire) {
                        if bridge_parent_exited(watcher_parent_pid) {
                            exit_after_parent_exit(&watcher_mountpoint, mount_id);
                        }
                        thread::sleep(Duration::from_millis(50));
                    }
                    if watcher_finished.load(Ordering::Acquire) {
                        return;
                    }
                    let mut next_status = std::time::Instant::now();
                    loop {
                        if watcher_finished.load(Ordering::Acquire) {
                            return;
                        }
                        if bridge_parent_exited(watcher_parent_pid) {
                            exit_after_parent_exit(&watcher_mountpoint, mount_id);
                        }
                        match unmount_owned_mount(&watcher_mountpoint, mount_id) {
                            Ok(()) => {
                                OWNED_MOUNT_UNMOUNTED.store(true, Ordering::Release);
                                return;
                            }
                            Err(error) => {
                                if std::time::Instant::now() >= next_status {
                                    eprintln!(
                                        "agent-drive-mount: eager unmount is blocked ({error}); close open files and directories and leave the mountpoint to stop; retrying every 5 seconds"
                                    );
                                    next_status = std::time::Instant::now()
                                        + Duration::from_secs(5);
                                }
                                thread::sleep(Duration::from_millis(250));
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(50));
            }
        })?;

    let session_result = session.run();
    finished.store(true, Ordering::Release);
    watcher
        .join()
        .map_err(|_| std::io::Error::other("unmount watcher thread panicked"))?;
    if OWNED_MOUNT_UNMOUNTED.load(Ordering::Acquire) {
        return Ok(());
    }
    session_result?;
    Ok(())
}

fn bridge_parent_exited(expected_parent: libc::pid_t) -> bool {
    #[cfg(target_os = "linux")]
    {
        unsafe { libc::getppid() != expected_parent }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = expected_parent;
        false
    }
}

fn exit_after_parent_exit(mountpoint: &Path, owned_mount_id: u64) -> ! {
    match unmount_owned_mount(mountpoint, owned_mount_id) {
        Ok(()) => eprintln!(
            "agent-drive-mount: bridge exited; detached this helper's mount with a normal unmount"
        ),
        Err(error) => eprintln!(
            "agent-drive-mount: bridge exited and the mount is still busy ({error}); after closing files and leaving the mountpoint, run `fusermount3 -u -- {}`",
            mountpoint.display()
        ),
    }
    std::process::exit(1)
}

#[cfg(target_os = "linux")]
fn owned_mount_id(mountpoint: &Path) -> std::io::Result<u64> {
    let mount_ids = mount_ids_at(mountpoint, &std::fs::read("/proc/self/mountinfo")?);
    if mount_ids.len() != 1 {
        return Err(std::io::Error::other(
            "could not identify this helper's mount unambiguously",
        ));
    }
    Ok(mount_ids[0])
}

#[cfg(not(target_os = "linux"))]
fn owned_mount_id(_mountpoint: &Path) -> std::io::Result<u64> {
    Ok(0)
}

#[cfg(target_os = "linux")]
fn mount_ids_at(mountpoint: &Path, mountinfo: &[u8]) -> Vec<u64> {
    use std::os::unix::ffi::OsStrExt;

    let escaped_mountpoint = escape_mountinfo_path(mountpoint.as_os_str().as_bytes());
    mountinfo
        .split(|byte| *byte == b'\n')
        .filter_map(|line| {
            let mut fields = line.split(u8::is_ascii_whitespace);
            let mount_id = std::str::from_utf8(fields.next()?)
                .ok()?
                .parse::<u64>()
                .ok()?;
            fields.next()?; // parent mount ID
            fields.next()?; // device number
            fields.next()?; // filesystem root
            let mounted_path = fields.next()?;
            (mounted_path == escaped_mountpoint.as_slice()).then_some(mount_id)
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn escape_mountinfo_path(path: &[u8]) -> Vec<u8> {
    let mut escaped = Vec::with_capacity(path.len());
    for byte in path {
        match byte {
            b' ' => escaped.extend_from_slice(b"\\040"),
            b'\t' => escaped.extend_from_slice(b"\\011"),
            b'\n' => escaped.extend_from_slice(b"\\012"),
            b'\\' => escaped.extend_from_slice(b"\\134"),
            _ => escaped.push(*byte),
        }
    }
    escaped
}

#[cfg(target_os = "linux")]
fn unmount_owned_mount(mountpoint: &Path, owned_mount_id: u64) -> std::io::Result<()> {
    let read_mount_ids = || {
        let mountinfo = std::fs::read("/proc/self/mountinfo")?;
        Ok::<_, std::io::Error>(mount_ids_at(mountpoint, &mountinfo))
    };
    let current_mount_ids = read_mount_ids()?;
    if !current_mount_ids.contains(&owned_mount_id) {
        return Ok(());
    }
    if current_mount_ids.len() != 1 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "another mount shares this mountpoint; refusing to unmount it",
        ));
    }

    if unsafe { libc::geteuid() } == 0 {
        use std::os::unix::ffi::OsStrExt;
        let mountpoint = std::ffi::CString::new(mountpoint.as_os_str().as_bytes())
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
        if unsafe { libc::umount(mountpoint.as_ptr()) } == 0 {
            return if !read_mount_ids()?.contains(&owned_mount_id) {
                Ok(())
            } else {
                Err(std::io::Error::other(
                    "unmount returned success but the owned mount is still present",
                ))
            };
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::EPERM) {
            return Err(error);
        }
    }

    let run_fusermount = |binary: &str| {
        Command::new(binary)
            .arg("-u")
            .arg("-q")
            .arg("--")
            .arg(mountpoint)
            .stdin(Stdio::null())
            .output()
    };
    let output = match run_fusermount("fusermount3") {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => run_fusermount("fusermount")?,
        result => result?,
    };
    let after_mount_ids = read_mount_ids()?;
    if !after_mount_ids.contains(&owned_mount_id) {
        return Ok(());
    }
    if output.status.success() {
        return Err(std::io::Error::other(
            "fusermount3 reported success but the owned mount is still present",
        ));
    }
    Err(std::io::Error::other(format!(
        "fusermount3 -u exited with {}",
        output.status
    )))
}

#[cfg(not(target_os = "linux"))]
fn unmount_owned_mount(_mountpoint: &Path, _owned_mount_id: u64) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "graceful owned unmount is only supported on Linux",
    ))
}

fn install_shutdown_handlers() -> std::io::Result<()> {
    SHUTDOWN_SIGNAL.store(0, Ordering::Release);
    OWNED_MOUNT_UNMOUNTED.store(false, Ordering::Release);
    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = record_shutdown_signal as _;
        action.sa_flags = 0;
        libc::sigemptyset(&mut action.sa_mask);
        for signal in [libc::SIGINT, libc::SIGTERM] {
            if libc::sigaction(signal, &action, std::ptr::null_mut()) != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
    }
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn mountinfo_lookup_matches_exact_escaped_mountpoint_and_reports_stacks() {
        let mountpoint = Path::new("/tmp/drive mount\\point");
        let mountinfo = concat!(
            "41 25 0:36 / /tmp/drive\\040mount\\134point rw,nosuid - fuse.agent-drive agent-drive rw\n",
            "42 25 0:37 / /tmp/drive\\040mount\\134point/child rw - tmpfs tmpfs rw\n",
            "43 25 0:38 / /tmp/drive\\040mount\\134point-other rw - tmpfs tmpfs rw\n"
        );
        assert_eq!(mount_ids_at(mountpoint, mountinfo.as_bytes()), vec![41]);
        assert_eq!(
            mount_ids_at(
                Path::new("/tmp/drive mount\\point/child"),
                mountinfo.as_bytes()
            ),
            vec![42]
        );
    }

    #[test]
    fn mountinfo_lookup_preserves_unicode_mountpoint_bytes() {
        let mountinfo = "61 25 0:36 / /tmp/Résumé rw - fuse.agent-drive agent-drive rw\n";
        assert_eq!(
            mount_ids_at(Path::new("/tmp/Résumé"), mountinfo.as_bytes()),
            vec![61]
        );
    }

    #[test]
    fn mountinfo_lookup_preserves_multiple_mount_ids_for_ownership_checks() {
        let mountinfo = concat!(
            "51 25 0:36 / /tmp/drive rw - fuse.agent-drive agent-drive rw\n",
            "52 25 0:37 / /tmp/drive rw - tmpfs tmpfs rw\n"
        );
        assert_eq!(
            mount_ids_at(Path::new("/tmp/drive"), mountinfo.as_bytes()),
            vec![51, 52]
        );
    }
}
