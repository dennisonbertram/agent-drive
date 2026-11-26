use agent_drive_mount::{Bridge, DriveFs, check_mountpoint};
use fuser::{Config, MountOption};
use std::{
    io::{BufReader, BufWriter},
    path::PathBuf,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("agent-drive-mount: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    {
        let parent = unsafe { libc::getppid() };
        if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if unsafe { libc::getppid() } != parent {
            return Err("bridge parent exited during startup".into());
        }
    }
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
    fuser::mount(fs, &mountpoint, &config)?;
    Ok(())
}
