use base64::{Engine as _, engine::general_purpose::STANDARD};
use fuser::{
    Errno, FileAttr, FileHandle, FileType, Filesystem, FopenFlags, Generation, INodeNo, LockOwner,
    OpenAccMode, OpenFlags, Owner, RenameFlags, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory,
    ReplyEmpty, ReplyEntry, ReplyOpen, ReplyWrite, Request, TimeOrNow, WriteFlags,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, Write},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant, UNIX_EPOCH},
};

const TTL: Duration = Duration::from_secs(1);
pub const MAX_READ: usize = 1024 * 1024;
pub const MAX_WRITE: usize = 1024 * 1024;
const MAX_CONTROL_LINE_BYTES: usize = 64 * 1024;
const MAX_DATA_LINE_BYTES: usize = 1536 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const ROOT_INO: u64 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub mtime_ms: i64,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    pub entries: Vec<Entry>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Deserialize)]
struct ReadResponse {
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MountCapabilities {
    pub read_only: bool,
    pub write: bool,
    pub delete: bool,
    pub write_paths: Vec<String>,
    pub max_read_bytes: usize,
    pub max_write_bytes: usize,
    pub ops: Vec<String>,
}
impl MountCapabilities {
    fn read_only() -> Self {
        Self {
            read_only: true,
            write: false,
            delete: false,
            write_paths: Vec::new(),
            max_read_bytes: MAX_READ,
            max_write_bytes: MAX_WRITE,
            ops: vec![
                "stat".into(),
                "list".into(),
                "read".into(),
                "capabilities".into(),
            ],
        }
    }
    pub fn supports(&self, op: &str) -> bool {
        self.ops.iter().any(|supported| supported == op)
    }
    fn can_write_path(&self, path: &str) -> bool {
        self.write
            && !self.read_only
            && (self.write_paths.is_empty()
                || self.write_paths.iter().any(|base| path_within(path, base)))
    }
    fn can_change_directory(&self, path: &str) -> bool {
        self.write
            && !self.read_only
            && (self.write_paths.is_empty()
                || self
                    .write_paths
                    .iter()
                    .any(|base| path_within(path, base) || path_within(base, path)))
    }
}

fn path_within(path: &str, base: &str) -> bool {
    base == "/"
        || path == base
        || path
            .strip_prefix(base)
            .is_some_and(|tail| tail.starts_with('/'))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitiesResponse {
    capabilities: MountCapabilities,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWriteResponse {
    pub handle_id: String,
    pub recovery_path: Option<String>,
    pub size: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BytesWrittenResponse {
    bytes_written: usize,
}
#[derive(Debug, Deserialize)]
struct SizeResponse {
    size: u64,
}
#[derive(Debug, Deserialize)]
struct StagedReadResponse {
    data: String,
    eof: bool,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommittedVersion {
    pub id: String,
    pub path: String,
}
#[derive(Debug, Deserialize)]
struct FlushResponse {
    version: CommittedVersion,
}
#[derive(Debug, Deserialize)]
struct MutationResponse {
    #[serde(default)]
    entry: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    id: u64,
    ok: bool,
    #[serde(default)]
    errno: Option<String>,
    #[serde(default)]
    recovery_path: Option<String>,
    #[serde(default)]
    current_version_id: Option<String>,
    #[serde(flatten)]
    body: serde_json::Value,
}
#[derive(Debug, Serialize)]
struct RequestMessage<'a, T> {
    id: u64,
    op: &'a str,
    #[serde(flatten)]
    args: T,
}

#[derive(Debug, thiserror::Error)]
pub enum MountError {
    #[error("bridge I/O failed")]
    Io(#[from] std::io::Error),
    #[error("bridge returned invalid JSON")]
    Json(#[from] serde_json::Error),
    #[error("bridge request failed: {errno}")]
    Remote {
        errno: String,
        recovery_path: Option<String>,
        current_version_id: Option<String>,
    },
    #[error("bridge returned an unexpected response")]
    InvalidResponse,
    #[error("invalid canonical drive path")]
    InvalidPath,
}

pub struct Bridge<R: BufRead, W: Write> {
    reader: R,
    writer: W,
    next_id: u64,
}
impl<R: BufRead, W: Write> Bridge<R, W> {
    pub fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer,
            next_id: 1,
        }
    }
    fn request<T: Serialize>(&mut self, op: &str, args: T) -> Result<Response, MountError> {
        let id = self.next_id;
        if id > MAX_SAFE_INTEGER {
            return Err(MountError::InvalidResponse);
        }
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or(MountError::InvalidResponse)?;
        let mut request = serde_json::to_vec(&RequestMessage { id, op, args })?;
        request.push(b'\n');
        let request_limit = if op == "write" {
            MAX_DATA_LINE_BYTES
        } else {
            MAX_CONTROL_LINE_BYTES
        };
        if request.len() > request_limit {
            return Err(MountError::InvalidResponse);
        }
        self.writer.write_all(&request)?;
        self.writer.flush()?;
        let mut line = Vec::new();
        loop {
            let available = self.reader.fill_buf()?;
            if available.is_empty() {
                if line.is_empty() {
                    return Err(MountError::Io(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "bridge closed",
                    )));
                }
                return Err(MountError::InvalidResponse);
            }
            let count = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |index| index + 1);
            let response_limit = if matches!(op, "read" | "readStaged") {
                MAX_DATA_LINE_BYTES
            } else {
                MAX_CONTROL_LINE_BYTES
            };
            if line.len().saturating_add(count) > response_limit {
                return Err(MountError::InvalidResponse);
            }
            let complete = available.get(count.wrapping_sub(1)) == Some(&b'\n');
            line.extend_from_slice(&available[..count]);
            self.reader.consume(count);
            if complete {
                break;
            }
        }
        let response: Response = serde_json::from_slice(&line)?;
        if response.id != id {
            return Err(MountError::InvalidResponse);
        }
        if !response.ok {
            return Err(MountError::Remote {
                errno: response.errno.unwrap_or_else(|| "EIO".into()),
                recovery_path: response.recovery_path,
                current_version_id: response.current_version_id,
            });
        }
        Ok(response)
    }
    pub fn list(&mut self, path: &str, cursor: Option<&str>) -> Result<ListResponse, MountError> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            cursor: Option<&'a str>,
        }
        let response = self.request("list", Args { path, cursor })?;
        Ok(serde_json::from_value(response.body)?)
    }
    pub fn read(
        &mut self,
        path: &str,
        version_id: &str,
        offset: u64,
        size: usize,
    ) -> Result<Vec<u8>, MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            path: &'a str,
            version_id: &'a str,
            offset: u64,
            size: usize,
        }
        if size > MAX_READ
            || offset
                .checked_add(size as u64)
                .is_none_or(|end| end > MAX_SAFE_INTEGER)
        {
            return Err(MountError::InvalidResponse);
        }
        let response = self.request(
            "read",
            Args {
                path,
                version_id,
                offset,
                size,
            },
        )?;
        let data: ReadResponse = serde_json::from_value(response.body)?;
        let bytes = STANDARD
            .decode(data.data)
            .map_err(|_| MountError::InvalidResponse)?;
        if bytes.len() > size {
            return Err(MountError::InvalidResponse);
        }
        Ok(bytes)
    }

    pub fn capabilities(&mut self) -> Result<MountCapabilities, MountError> {
        let response = self.request("capabilities", serde_json::Value::Null)?;
        Ok(serde_json::from_value::<CapabilitiesResponse>(response.body)?.capabilities)
    }

    pub fn open_write(
        &mut self,
        path: &str,
        base_version_id: Option<&str>,
    ) -> Result<OpenWriteResponse, MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            path: &'a str,
            base_version_id: Option<&'a str>,
        }
        let response = self.request(
            "openWrite",
            Args {
                path,
                base_version_id,
            },
        )?;
        let mut opened: OpenWriteResponse = serde_json::from_value(response.body)?;
        if response.recovery_path.is_some() {
            opened.recovery_path = response.recovery_path;
        }
        if opened.handle_id.is_empty()
            || opened.handle_id.len() > 256
            || opened
                .recovery_path
                .as_ref()
                .is_some_and(|path| path.len() > 4096)
            || opened.size > MAX_SAFE_INTEGER
        {
            return Err(MountError::InvalidResponse);
        }
        Ok(opened)
    }

    pub fn write(
        &mut self,
        handle_id: &str,
        offset: u64,
        data: &[u8],
    ) -> Result<usize, MountError> {
        if data.len() > MAX_WRITE
            || offset
                .checked_add(data.len() as u64)
                .is_none_or(|end| end > MAX_SAFE_INTEGER)
        {
            return Err(MountError::InvalidResponse);
        }
        if data.is_empty() {
            return Ok(0);
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            handle_id: &'a str,
            offset: u64,
            data: String,
        }
        let response = self.request(
            "write",
            Args {
                handle_id,
                offset,
                data: STANDARD.encode(data),
            },
        )?;
        let written: BytesWrittenResponse = serde_json::from_value(response.body)?;
        if written.bytes_written > data.len() {
            return Err(MountError::InvalidResponse);
        }
        Ok(written.bytes_written)
    }

    pub fn truncate(&mut self, handle_id: &str, size: u64) -> Result<u64, MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            handle_id: &'a str,
            size: u64,
        }
        let response = self.request("truncate", Args { handle_id, size })?;
        let result: SizeResponse = serde_json::from_value(response.body)?;
        Ok(result.size)
    }

    pub fn read_staged(
        &mut self,
        handle_id: &str,
        offset: u64,
        size: usize,
    ) -> Result<(Vec<u8>, bool), MountError> {
        if size > MAX_READ
            || offset
                .checked_add(size as u64)
                .is_none_or(|end| end > MAX_SAFE_INTEGER)
        {
            return Err(MountError::InvalidResponse);
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            handle_id: &'a str,
            offset: u64,
            size: usize,
        }
        let response = self.request(
            "readStaged",
            Args {
                handle_id,
                offset,
                size,
            },
        )?;
        let staged: StagedReadResponse = serde_json::from_value(response.body)?;
        let bytes = STANDARD
            .decode(staged.data)
            .map_err(|_| MountError::InvalidResponse)?;
        if bytes.len() > size {
            return Err(MountError::InvalidResponse);
        }
        Ok((bytes, staged.eof))
    }

    pub fn flush(&mut self, handle_id: &str) -> Result<CommittedVersion, MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            handle_id: &'a str,
        }
        let response = self.request("flush", Args { handle_id })?;
        Ok(serde_json::from_value::<FlushResponse>(response.body)?.version)
    }

    pub fn release(&mut self, handle_id: &str) -> Result<(), MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            handle_id: &'a str,
        }
        let _ = self.request("release", Args { handle_id })?;
        Ok(())
    }

    pub fn mkdir(&mut self, path: &str) -> Result<(), MountError> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
        }
        let _ =
            serde_json::from_value::<MutationResponse>(self.request("mkdir", Args { path })?.body)?;
        Ok(())
    }

    pub fn rmdir(&mut self, path: &str) -> Result<(), MountError> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
        }
        let _ =
            serde_json::from_value::<MutationResponse>(self.request("rmdir", Args { path })?.body)?;
        Ok(())
    }

    pub fn unlink(&mut self, path: &str, if_version_id: &str) -> Result<(), MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            path: &'a str,
            if_version_id: &'a str,
        }
        let _ = serde_json::from_value::<MutationResponse>(
            self.request(
                "unlink",
                Args {
                    path,
                    if_version_id,
                },
            )?
            .body,
        )?;
        Ok(())
    }

    pub fn rename(
        &mut self,
        path: &str,
        destination_path: &str,
        if_source_version_id: &str,
        if_destination_version_id: Option<&str>,
        operation_id: &str,
    ) -> Result<Option<serde_json::Value>, MountError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            path: &'a str,
            destination_path: &'a str,
            if_source_version_id: &'a str,
            if_destination_version_id: Option<&'a str>,
            operation_id: &'a str,
        }
        let response = serde_json::from_value::<MutationResponse>(
            self.request(
                "rename",
                Args {
                    path,
                    destination_path,
                    if_source_version_id,
                    if_destination_version_id,
                    operation_id,
                },
            )?
            .body,
        )?;
        Ok(response.entry)
    }
}

#[derive(Clone, Debug)]
struct Node {
    ino: u64,
    path: String,
    name: String,
    kind: FileType,
    size: u64,
    mtime_ms: i64,
    version_id: Option<String>,
    read_only: bool,
    observed_at: Instant,
    mode: u16,
    uid: u32,
    gid: u32,
}
struct DirCache {
    cursor: Option<String>,
    seen_cursors: HashSet<String>,
    exhausted: bool,
    started_at: Instant,
    fetched_at: Instant,
}
#[derive(Clone)]
struct DirectoryItem {
    name: String,
    ino: u64,
    kind: FileType,
}
#[derive(Clone)]
struct DirectoryHandleState {
    ino: u64,
    path: String,
    page_start: usize,
    page: Vec<DirectoryItem>,
    next_cursor: Option<String>,
    seen_cursors: HashSet<String>,
    used_cursors: HashSet<String>,
    exhausted: bool,
    started: bool,
}
#[derive(Clone)]
struct FileHandleState {
    node: Node,
    writable: bool,
    readable: bool,
    staged: Option<StagedFile>,
}
#[derive(Clone)]
struct StagedFile {
    handle_id: String,
    recovery_path: Option<String>,
    current_version_id: Option<String>,
    dirty: bool,
}
struct State {
    nodes: HashMap<u64, Node>,
    paths: HashMap<String, u64>,
    dirs: HashMap<String, DirCache>,
    next_ino: u64,
    handles: HashMap<u64, FileHandleState>,
    directory_handles: HashMap<u64, DirectoryHandleState>,
    lookup_refs: HashMap<u64, u64>,
    next_handle: u64,
}
#[derive(Clone)]
pub struct MountActivity {
    state: Arc<RwLock<State>>,
}
impl MountActivity {
    pub fn is_idle(&self) -> bool {
        let (files, directories) = self.open_handle_counts();
        files == 0 && directories == 0
    }
    pub fn open_handle_counts(&self) -> (usize, usize) {
        let state = self.state.read().unwrap();
        (state.handles.len(), state.directory_handles.len())
    }
}
pub struct DriveFs<R: BufRead + Send, W: Write + Send> {
    bridge: Arc<Mutex<Bridge<R, W>>>,
    state: Arc<RwLock<State>>,
    list_lock: Mutex<()>,
    capabilities: MountCapabilities,
    read_write: bool,
    uid: u32,
    gid: u32,
}
impl<R: BufRead + Send, W: Write + Send> DriveFs<R, W> {
    pub fn mount_activity(&self) -> MountActivity {
        MountActivity {
            state: self.state.clone(),
        }
    }
    pub fn new(bridge: Bridge<R, W>, uid: u32, gid: u32) -> Self {
        Self::with_capabilities(bridge, uid, gid, MountCapabilities::read_only(), false)
    }

    pub fn with_capabilities(
        bridge: Bridge<R, W>,
        uid: u32,
        gid: u32,
        capabilities: MountCapabilities,
        read_write: bool,
    ) -> Self {
        let root_mode = if read_write && capabilities.write && !capabilities.read_only {
            0o700
        } else {
            0o500
        };
        let root = Node {
            ino: ROOT_INO,
            path: "/".into(),
            name: "/".into(),
            kind: FileType::Directory,
            size: 0,
            mtime_ms: 0,
            version_id: None,
            read_only: false,
            observed_at: Instant::now(),
            mode: root_mode,
            uid,
            gid,
        };
        let mut nodes = HashMap::new();
        nodes.insert(ROOT_INO, root);
        let mut paths = HashMap::new();
        paths.insert("/".into(), ROOT_INO);
        Self {
            bridge: Arc::new(Mutex::new(bridge)),
            state: Arc::new(RwLock::new(State {
                nodes,
                paths,
                dirs: HashMap::new(),
                next_ino: 2,
                handles: HashMap::new(),
                directory_handles: HashMap::new(),
                lookup_refs: HashMap::new(),
                next_handle: 1,
            })),
            list_lock: Mutex::new(()),
            capabilities,
            read_write,
            uid,
            gid,
        }
    }
    fn errno(error: MountError) -> i32 {
        match error {
            MountError::Remote { ref errno, .. } => match errno.as_str() {
                "ENOENT" => libc::ENOENT,
                "EACCES" => libc::EACCES,
                "ESTALE" => libc::ESTALE,
                "EROFS" => libc::EROFS,
                "EINVAL" => libc::EINVAL,
                "EEXIST" => libc::EEXIST,
                "ENOTEMPTY" => libc::ENOTEMPTY,
                "ENOSPC" => libc::ENOSPC,
                "EPERM" => libc::EPERM,
                "ENOTDIR" => libc::ENOTDIR,
                "EISDIR" => libc::EISDIR,
                "EBUSY" => libc::EBUSY,
                "EDQUOT" => libc::EDQUOT,
                "EFBIG" => libc::EFBIG,
                _ => libc::EIO,
            },
            MountError::InvalidPath => libc::EINVAL,
            _ => libc::EIO,
        }
    }
    fn valid_path(path: &str) -> bool {
        path == "/"
            || (path.starts_with('/')
                && path.len() <= 1024
                && !path.ends_with('/')
                && !path.contains("//")
                && !path.contains('\\')
                && path
                    .split('/')
                    .skip(1)
                    .all(|part| !part.is_empty() && part != "." && part != ".."))
    }
    fn can_write_path(&self, path: &str) -> bool {
        self.read_write && self.capabilities.can_write_path(path)
    }
    fn can_change_directory(&self, path: &str) -> bool {
        self.read_write && self.capabilities.can_change_directory(path)
    }
    fn entry_mode(&self, path: &str, kind: FileType, read_only: bool) -> u16 {
        match kind {
            FileType::Directory if self.can_change_directory(path) => 0o700,
            FileType::Directory => 0o500,
            FileType::RegularFile if !read_only && self.can_write_path(path) => 0o600,
            FileType::RegularFile => 0o400,
            _ => 0,
        }
    }
    fn ensure_child(&self, path: &str, name: &str) -> Result<Option<Node>, i32> {
        if !Self::valid_path(path) {
            return Err(libc::EINVAL);
        }
        let full_path = if path == "/" {
            format!("/{name}")
        } else {
            format!("{path}/{name}")
        };
        let _listing = self.list_lock.lock().unwrap();
        let mut fresh_scan = false;
        {
            let mut state = self.state.write().unwrap();
            let stale = state
                .dirs
                .get(path)
                .is_none_or(|cache| cache.fetched_at.elapsed() >= TTL);
            if stale {
                let now = Instant::now();
                state.dirs.insert(
                    path.to_owned(),
                    DirCache {
                        cursor: None,
                        seen_cursors: HashSet::new(),
                        exhausted: false,
                        started_at: now,
                        fetched_at: now,
                    },
                );
                fresh_scan = true;
            }
        }
        loop {
            let cached = {
                let state = self.state.read().unwrap();
                let cache = state.dirs.get(path).expect("directory cache initialized");
                state
                    .paths
                    .get(&full_path)
                    .and_then(|ino| state.nodes.get(ino))
                    .filter(|node| node.observed_at >= cache.started_at)
                    .cloned()
            };
            if cached.is_some() {
                return Ok(cached);
            }
            let (cursor, exhausted, seen) = {
                let state = self.state.read().unwrap();
                let cache = state.dirs.get(path).expect("directory cache initialized");
                (
                    cache.cursor.clone(),
                    cache.exhausted,
                    cache.seen_cursors.clone(),
                )
            };
            if exhausted {
                if fresh_scan {
                    return Ok(None);
                }
                let mut state = self.state.write().unwrap();
                let now = Instant::now();
                state.dirs.insert(
                    path.to_owned(),
                    DirCache {
                        cursor: None,
                        seen_cursors: HashSet::new(),
                        exhausted: false,
                        started_at: now,
                        fetched_at: now,
                    },
                );
                fresh_scan = true;
                continue;
            }
            let page = self
                .bridge
                .lock()
                .unwrap()
                .list(path, cursor.as_deref())
                .map_err(Self::errno)?;
            if let Some(next) = page.next_cursor.as_ref() {
                if cursor.as_ref() == Some(next) || seen.contains(next) {
                    return Err(libc::EIO);
                }
            }
            let nodes = self.intern_entries(path, page.entries);
            let found = nodes.into_iter().find(|node| node.name == name);
            let mut state = self.state.write().unwrap();
            let cache = state
                .dirs
                .get_mut(path)
                .expect("directory cache initialized");
            cache.cursor = page.next_cursor.clone();
            if let Some(next) = page.next_cursor.as_ref() {
                cache.seen_cursors.insert(next.clone());
            }
            cache.exhausted = page.next_cursor.is_none();
            cache.fetched_at = Instant::now();
            if found.is_some() {
                return Ok(found);
            }
        }
    }
    fn intern_entries(&self, path: &str, mut entries: Vec<Entry>) -> Vec<Node> {
        entries.sort_by(|a, b| {
            a.name
                .cmp(&b.name)
                .then_with(|| match (a.kind.as_str(), b.kind.as_str()) {
                    ("directory", "file") => std::cmp::Ordering::Less,
                    ("file", "directory") => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                })
        });
        let mut state = self.state.write().unwrap();
        let cache_now = Instant::now();
        state
            .dirs
            .entry(path.to_owned())
            .or_insert_with(|| DirCache {
                cursor: None,
                seen_cursors: HashSet::new(),
                exhausted: false,
                started_at: cache_now,
                fetched_at: cache_now,
            });
        let mut children = Vec::new();
        let mut child_ids = HashSet::new();
        for entry in entries {
            if entry.name.is_empty()
                || entry.name == "."
                || entry.name == ".."
                || entry.name.contains('/')
                || entry.name.contains('\\')
            {
                continue;
            }
            let child_path = if path == "/" {
                format!("/{name}", name = entry.name)
            } else {
                format!("{path}/{name}", name = entry.name)
            };
            let kind = match entry.kind.as_str() {
                "file" if entry.version_id.is_some() => FileType::RegularFile,
                "directory" => FileType::Directory,
                _ => continue,
            };
            let now = Instant::now();
            let ino = if let Some(existing_ino) = state.paths.get(&child_path).copied() {
                if let Some(existing) = state.nodes.get_mut(&existing_ino) {
                    if existing.kind != FileType::Directory || kind == FileType::Directory {
                        existing.kind = kind;
                        existing.size = if kind == FileType::RegularFile {
                            entry.size
                        } else {
                            0
                        };
                        existing.mtime_ms = entry.mtime_ms;
                        existing.version_id = if kind == FileType::RegularFile {
                            entry.version_id
                        } else {
                            None
                        };
                        existing.read_only = entry.read_only;
                        existing.mode = self.entry_mode(&child_path, kind, existing.read_only);
                    }
                    existing.observed_at = now;
                    existing.clone()
                } else {
                    continue;
                }
            } else {
                let ino = state.next_ino;
                state.next_ino = state.next_ino.saturating_add(1);
                let node = Node {
                    ino,
                    path: child_path.clone(),
                    name: entry.name,
                    kind,
                    size: if kind == FileType::RegularFile {
                        entry.size
                    } else {
                        0
                    },
                    mtime_ms: entry.mtime_ms,
                    version_id: if kind == FileType::RegularFile {
                        entry.version_id
                    } else {
                        None
                    },
                    read_only: entry.read_only,
                    observed_at: now,
                    mode: self.entry_mode(&child_path, kind, entry.read_only),
                    uid: self.uid,
                    gid: self.gid,
                };
                state.paths.insert(child_path, ino);
                state.nodes.insert(ino, node.clone());
                node
            };
            if child_ids.insert(ino.ino) {
                children.push(ino);
            }
        }
        children
    }
    fn load_directory_page(
        &self,
        fh: FileHandle,
        child_offset: usize,
    ) -> Result<DirectoryHandleState, i32> {
        let _listing = self.list_lock.lock().unwrap();
        loop {
            let current = self
                .state
                .read()
                .unwrap()
                .directory_handles
                .get(&fh.0)
                .cloned()
                .ok_or(libc::EBADF)?;
            let page_end = current.page_start.saturating_add(current.page.len());
            if current.started && child_offset >= current.page_start && child_offset < page_end {
                return Ok(current);
            }
            if current.exhausted && (current.started && child_offset >= page_end) {
                return Ok(current);
            }
            if !current.started || child_offset < current.page_start {
                let mut state = self.state.write().unwrap();
                let handle = state.directory_handles.get_mut(&fh.0).ok_or(libc::EBADF)?;
                let evicted: Vec<u64> = handle.page.iter().map(|item| item.ino).collect();
                handle.page_start = 0;
                handle.page.clear();
                handle.next_cursor = None;
                handle.seen_cursors.clear();
                handle.used_cursors.clear();
                handle.exhausted = false;
                handle.started = false;
                drop(state);
                self.prune_nodes(evicted);
            }
            let current = self
                .state
                .read()
                .unwrap()
                .directory_handles
                .get(&fh.0)
                .cloned()
                .ok_or(libc::EBADF)?;
            let cursor = current.next_cursor.clone();
            if let Some(cursor) = cursor.as_ref() {
                if current.used_cursors.contains(cursor) {
                    return Err(libc::EIO);
                }
            }
            let page = self
                .bridge
                .lock()
                .unwrap()
                .list(&current.path, cursor.as_deref())
                .map_err(Self::errno)?;
            if let Some(next) = page.next_cursor.as_ref() {
                if cursor.as_ref() == Some(next) || current.seen_cursors.contains(next) {
                    return Err(libc::EIO);
                }
            }
            let nodes = self.intern_entries(&current.path, page.entries);
            let items: Vec<DirectoryItem> = nodes
                .into_iter()
                .map(|node| DirectoryItem {
                    name: node.name,
                    ino: node.ino,
                    kind: node.kind,
                })
                .collect();
            let mut state = self.state.write().unwrap();
            let handle = state.directory_handles.get_mut(&fh.0).ok_or(libc::EBADF)?;
            let evicted: Vec<u64> = handle.page.iter().map(|item| item.ino).collect();
            if let Some(cursor) = cursor.as_ref() {
                handle.used_cursors.insert(cursor.clone());
            }
            handle.page_start = if handle.started {
                handle.page_start.saturating_add(handle.page.len())
            } else {
                0
            };
            handle.page = items;
            handle.next_cursor = page.next_cursor.clone();
            if let Some(next) = page.next_cursor.as_ref() {
                handle.seen_cursors.insert(next.clone());
            }
            handle.exhausted = page.next_cursor.is_none();
            handle.started = true;
            let end = handle.page_start.saturating_add(handle.page.len());
            let result = handle.clone();
            drop(state);
            self.prune_nodes(evicted);
            if child_offset >= result.page_start && child_offset < end {
                return Ok(result);
            }
            if result.exhausted {
                return Ok(result);
            }
            if result.page.is_empty() {
                continue;
            }
        }
    }
    fn node(&self, ino: u64) -> Option<Node> {
        self.state.read().unwrap().nodes.get(&ino).cloned()
    }
    fn note_lookup(&self, ino: u64) {
        let mut state = self.state.write().unwrap();
        let refs = state.lookup_refs.entry(ino).or_default();
        *refs = refs.saturating_add(1);
    }
    fn prune_nodes(&self, candidates: impl IntoIterator<Item = u64>) {
        let mut state = self.state.write().unwrap();
        for ino in candidates {
            if ino == ROOT_INO || state.lookup_refs.get(&ino).copied().unwrap_or(0) > 0 {
                continue;
            }
            if state.handles.values().any(|handle| handle.node.ino == ino)
                || state.directory_handles.values().any(|handle| {
                    handle.ino == ino || handle.page.iter().any(|item| item.ino == ino)
                })
            {
                continue;
            }
            if let Some(node) = state.nodes.remove(&ino) {
                state.paths.remove(&node.path);
                state.lookup_refs.remove(&ino);
            }
        }
    }
    fn open_write_handle(
        &self,
        mut node: Node,
        readable: bool,
        writable: bool,
        initially_dirty: bool,
    ) -> Result<u64, i32> {
        if node.read_only {
            return Err(libc::EROFS);
        }
        if !self.can_write_path(&node.path)
            || !self.capabilities.supports("openWrite")
            || !self.capabilities.supports("write")
        {
            return Err(libc::EACCES);
        }
        if node.kind != FileType::RegularFile {
            return Err(libc::EISDIR);
        }
        let opened = self
            .bridge
            .lock()
            .unwrap()
            .open_write(&node.path, node.version_id.as_deref())
            .map_err(Self::errno)?;
        node.size = opened.size;
        node.observed_at = Instant::now();
        node.mode = self.entry_mode(&node.path, node.kind, node.read_only);
        let mut state = self.state.write().unwrap();
        let fh = state.next_handle;
        state.next_handle = state.next_handle.saturating_add(1);
        state.handles.insert(
            fh,
            FileHandleState {
                node,
                writable,
                readable,
                staged: Some(StagedFile {
                    handle_id: opened.handle_id,
                    recovery_path: opened.recovery_path,
                    current_version_id: None,
                    dirty: initially_dirty,
                }),
            },
        );
        Ok(fh)
    }
    fn update_recovery_path(&self, fh: u64, error: &MountError) {
        if let MountError::Remote {
            recovery_path,
            current_version_id,
            ..
        } = error
        {
            if let Some(stage) = self
                .state
                .write()
                .unwrap()
                .handles
                .get_mut(&fh)
                .and_then(|handle| handle.staged.as_mut())
            {
                if let Some(path) = recovery_path {
                    stage.recovery_path = Some(path.clone());
                }
                stage.current_version_id = current_version_id.clone();
            }
        }
    }
    fn flush_stage(&self, fh: u64) -> Result<(), i32> {
        let _listing = self.list_lock.lock().unwrap();
        let handle = self
            .state
            .read()
            .unwrap()
            .handles
            .get(&fh)
            .cloned()
            .ok_or(libc::EBADF)?;
        let Some(stage) = handle.staged else {
            return Ok(());
        };
        if !stage.dirty {
            return Ok(());
        }
        if !self.capabilities.supports("flush") {
            return Err(libc::EROFS);
        }
        let result = self.bridge.lock().unwrap().flush(&stage.handle_id);
        match result {
            Ok(version)
                if version.id.is_empty()
                    || version.id.len() > 256
                    || !Self::valid_path(&version.path)
                    || version.path != handle.node.path =>
            {
                Err(libc::EIO)
            }
            Ok(version) => {
                let mut state = self.state.write().unwrap();
                let updated = {
                    let Some(current) = state.handles.get_mut(&fh) else {
                        return Err(libc::EBADF);
                    };
                    let old_path = current.node.path.clone();
                    let version_id = version.id.clone();
                    current.node.path = version.path;
                    current.node.name = current.node.path.rsplit('/').next().unwrap_or("").into();
                    current.node.version_id = Some(version_id.clone());
                    current.node.observed_at = Instant::now();
                    if let Some(current_stage) = current.staged.as_mut() {
                        current_stage.dirty = false;
                        current_stage.recovery_path = None;
                        current_stage.current_version_id = Some(version_id);
                    }
                    (old_path, current.node.clone())
                };
                if state.paths.get(&updated.0) == Some(&updated.1.ino) {
                    state.paths.remove(&updated.0);
                }
                state.paths.insert(updated.1.path.clone(), updated.1.ino);
                state.nodes.insert(updated.1.ino, updated.1);
                Ok(())
            }
            Err(error) => {
                self.update_recovery_path(fh, &error);
                Err(Self::errno(error))
            }
        }
    }
    fn finish_release(&self, fh: u64) -> Result<(), i32> {
        let handle = self.state.read().unwrap().handles.get(&fh).cloned();
        let mut release_error = None;
        if let Some(stage) = handle.as_ref().and_then(|handle| handle.staged.as_ref()) {
            if stage.dirty {
                if let Err(error) = self.flush_stage(fh) {
                    release_error = Some(error);
                }
            }
            if let Err(error) = self.bridge.lock().unwrap().release(&stage.handle_id) {
                self.update_recovery_path(fh, &error);
                release_error.get_or_insert_with(|| Self::errno(error));
            }
        }
        let released = self
            .state
            .write()
            .unwrap()
            .handles
            .remove(&fh)
            .map(|handle| handle.node.ino);
        if let Some(ino) = released {
            self.prune_nodes([ino]);
        }
        match release_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
    fn truncate_stage(&self, fh: u64, size: u64) -> Result<Node, i32> {
        if size > MAX_SAFE_INTEGER {
            return Err(libc::EINVAL);
        }
        let handle = self
            .state
            .read()
            .unwrap()
            .handles
            .get(&fh)
            .cloned()
            .ok_or(libc::EBADF)?;
        if !handle.writable {
            return Err(libc::EACCES);
        }
        if handle.node.read_only || !self.can_write_path(&handle.node.path) {
            return Err(libc::EACCES);
        }
        let Some(stage) = handle.staged else {
            return Err(libc::EROFS);
        };
        if !self.capabilities.supports("truncate") {
            return Err(libc::EROFS);
        }
        let result = self.bridge.lock().unwrap().truncate(&stage.handle_id, size);
        let new_size = match result {
            Ok(new_size) if new_size == size => new_size,
            Ok(_) => return Err(libc::EIO),
            Err(error) => {
                self.update_recovery_path(fh, &error);
                return Err(Self::errno(error));
            }
        };
        let mut state = self.state.write().unwrap();
        let current = state.handles.get_mut(&fh).ok_or(libc::EBADF)?;
        current.node.size = new_size;
        current.node.observed_at = Instant::now();
        if let Some(current_stage) = current.staged.as_mut() {
            current_stage.dirty = true;
        }
        let node = current.node.clone();
        state.nodes.insert(node.ino, node.clone());
        Ok(node)
    }
    fn refresh_parent(&self, path: &str) {
        let Some((parent, _)) = path.rsplit_once('/') else {
            return;
        };
        let parent = if parent.is_empty() { "/" } else { parent };
        if let Some(cache) = self.state.write().unwrap().dirs.get_mut(parent) {
            cache.fetched_at = Instant::now().checked_sub(TTL).unwrap_or_else(Instant::now);
        }
    }
    fn insert_node(&self, mut node: Node) -> Node {
        let mut state = self.state.write().unwrap();
        if let Some(ino) = state.paths.get(&node.path).copied() {
            node.ino = ino;
        } else {
            node.ino = state.next_ino;
            state.next_ino = state.next_ino.saturating_add(1);
        }
        state.paths.insert(node.path.clone(), node.ino);
        state.nodes.insert(node.ino, node.clone());
        node
    }
    fn remove_node_path(&self, path: &str) {
        let ino = {
            let mut state = self.state.write().unwrap();
            let ino = state.paths.remove(path);
            if let Some(ino) = ino {
                if let Some(node) = state.nodes.get_mut(&ino) {
                    node.observed_at = Instant::now().checked_sub(TTL).unwrap_or_else(Instant::now);
                }
            }
            ino
        };
        self.refresh_parent(path);
        if let Some(ino) = ino {
            self.prune_nodes([ino]);
        }
    }
    fn retarget_open_handles(
        state: &mut State,
        source_ino: u64,
        moved: &Node,
        source_stage_id: Option<&str>,
    ) {
        for handle in state
            .handles
            .values_mut()
            .filter(|handle| handle.node.ino == source_ino)
        {
            let staged_handle = handle.staged.as_mut();
            if staged_handle
                .as_ref()
                .is_some_and(|stage| source_stage_id != Some(stage.handle_id.as_str()))
            {
                continue;
            }
            handle.node.path = moved.path.clone();
            handle.node.name = moved.name.clone();
            handle.node.observed_at = moved.observed_at;
            handle.node.mode = moved.mode;
            if let Some(stage) = staged_handle {
                handle.node.version_id = moved.version_id.clone();
                handle.node.size = moved.size;
                handle.node.mtime_ms = moved.mtime_ms;
                stage.dirty = false;
                stage.current_version_id = moved.version_id.clone();
            }
        }
    }
    fn next_operation_id(&self) -> Result<String, i32> {
        let mut bytes = [0_u8; 16];
        let mut filled = 0;
        while filled < bytes.len() {
            let result = unsafe {
                libc::getrandom(bytes[filled..].as_mut_ptr().cast(), bytes.len() - filled, 0)
            };
            if result < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error.raw_os_error().unwrap_or(libc::EIO));
            }
            if result == 0 {
                return Err(libc::EIO);
            }
            filled += result as usize;
        }

        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        Ok(format!(
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            bytes[0],
            bytes[1],
            bytes[2],
            bytes[3],
            bytes[4],
            bytes[5],
            bytes[6],
            bytes[7],
            bytes[8],
            bytes[9],
            bytes[10],
            bytes[11],
            bytes[12],
            bytes[13],
            bytes[14],
            bytes[15]
        ))
    }
    fn version_guard_for_node(&self, node: &Node) -> Result<String, i32> {
        let stages: Vec<String> = self
            .state
            .read()
            .unwrap()
            .handles
            .values()
            .filter(|handle| handle.node.ino == node.ino)
            .filter_map(|handle| handle.staged.as_ref())
            .map(|stage| stage.handle_id.clone())
            .collect();
        match stages.as_slice() {
            [handle_id] => Ok(format!("staged:{handle_id}")),
            [] => node.version_id.clone().ok_or(libc::ESTALE),
            _ => Err(libc::EBUSY),
        }
    }
    fn child_path(parent: &Node, name: &std::ffi::OsStr) -> Result<(String, String), i32> {
        if parent.kind != FileType::Directory {
            return Err(libc::ENOTDIR);
        }
        let name = name.to_str().ok_or(libc::EINVAL)?;
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.contains('/')
            || name.contains('\\')
            || name.contains('\0')
        {
            return Err(libc::EINVAL);
        }
        let path = if parent.path == "/" {
            format!("/{name}")
        } else {
            format!("{}/{name}", parent.path)
        };
        if !Self::valid_path(&path) {
            return Err(libc::EINVAL);
        }
        Ok((path, name.to_owned()))
    }
    fn attr(&self, node: &Node) -> FileAttr {
        let seconds = node.mtime_ms.div_euclid(1000).max(0) as u64;
        FileAttr {
            ino: INodeNo(node.ino),
            size: node.size,
            blocks: node.size.div_ceil(512),
            atime: UNIX_EPOCH,
            mtime: UNIX_EPOCH + Duration::from_secs(seconds),
            ctime: UNIX_EPOCH + Duration::from_secs(seconds),
            crtime: UNIX_EPOCH,
            kind: node.kind,
            perm: node.mode,
            nlink: if node.kind == FileType::Directory {
                2
            } else {
                1
            },
            uid: node.uid,
            gid: node.gid,
            rdev: 0,
            blksize: 4096,
            flags: 0,
        }
    }
}
impl<R: BufRead + Send + 'static, W: Write + Send + 'static> Filesystem for DriveFs<R, W> {
    fn lookup(&self, _req: &Request, parent: INodeNo, name: &std::ffi::OsStr, reply: ReplyEntry) {
        let Some(parent_node) = self.node(parent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let Some(name) = name.to_str() else {
            reply.error(Errno::EINVAL);
            return;
        };
        if name == "." {
            self.note_lookup(parent_node.ino);
            reply.entry(&TTL, &self.attr(&parent_node), Generation(0));
            return;
        }
        if name == ".." {
            let p = if parent_node.path == "/" {
                "/"
            } else {
                parent_node
                    .path
                    .rsplit_once('/')
                    .map(|(p, _)| if p.is_empty() { "/" } else { p })
                    .unwrap_or("/")
            };
            let state = self.state.read().unwrap();
            let Some(node) = state
                .paths
                .get(p)
                .and_then(|id| state.nodes.get(id))
                .cloned()
            else {
                reply.error(Errno::ENOENT);
                return;
            };
            drop(state);
            self.note_lookup(node.ino);
            reply.entry(&TTL, &self.attr(&node), Generation(0));
            return;
        }
        if parent_node.kind != FileType::Directory {
            reply.error(Errno::ENOTDIR);
            return;
        }
        match self.ensure_child(&parent_node.path, name) {
            Ok(Some(child)) => {
                self.note_lookup(child.ino);
                reply.entry(&TTL, &self.attr(&child), Generation(0));
            }
            Ok(None) => reply.error(Errno::ENOENT),
            Err(e) => reply.error(Errno::from_i32(e)),
        }
    }
    fn getattr(&self, _req: &Request, ino: INodeNo, fh: Option<FileHandle>, reply: ReplyAttr) {
        let node = fh
            .and_then(|handle| {
                self.state
                    .read()
                    .unwrap()
                    .handles
                    .get(&handle.0)
                    .map(|h| h.node.clone())
            })
            .or_else(|| self.node(ino.0));
        if let Some(n) = node {
            reply.attr(&TTL, &self.attr(&n));
        } else {
            reply.error(Errno::ENOENT);
        }
    }
    fn opendir(&self, _req: &Request, ino: INodeNo, _flags: OpenFlags, reply: ReplyOpen) {
        let Some(node) = self.node(ino.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        if node.kind != FileType::Directory {
            reply.error(Errno::ENOTDIR);
            return;
        }
        let mut state = self.state.write().unwrap();
        let fh = state.next_handle;
        state.next_handle = state.next_handle.saturating_add(1);
        state.directory_handles.insert(
            fh,
            DirectoryHandleState {
                ino: node.ino,
                path: node.path,
                page_start: 0,
                page: Vec::new(),
                next_cursor: None,
                seen_cursors: HashSet::new(),
                used_cursors: HashSet::new(),
                exhausted: false,
                started: false,
            },
        );
        reply.opened(FileHandle(fh), FopenFlags::empty());
    }
    fn readdir(
        &self,
        _req: &Request,
        ino: INodeNo,
        fh: FileHandle,
        offset: u64,
        mut reply: ReplyDirectory,
    ) {
        let Some(dir) = self.node(ino.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        if dir.kind != FileType::Directory {
            reply.error(Errno::ENOTDIR);
            return;
        }
        let child_offset = offset.saturating_sub(2) as usize;
        let listing = match self.load_directory_page(fh, child_offset) {
            Ok(listing) => listing,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        let parent_path = if dir.path == "/" {
            "/"
        } else {
            dir.path
                .rsplit_once('/')
                .map(|(p, _)| if p.is_empty() { "/" } else { p })
                .unwrap_or("/")
        };
        let parent_ino = self
            .state
            .read()
            .unwrap()
            .paths
            .get(parent_path)
            .copied()
            .unwrap_or(ROOT_INO);
        if offset == 0 && reply.add(INodeNo(ino.0), 1, FileType::Directory, ".") {
            reply.ok();
            return;
        }
        if offset <= 1 && reply.add(INodeNo(parent_ino), 2, FileType::Directory, "..") {
            reply.ok();
            return;
        }
        let start = child_offset.saturating_sub(listing.page_start);
        for (index, item) in listing.page.iter().enumerate().skip(start) {
            let next_offset = 3u64.saturating_add((listing.page_start + index) as u64);
            if reply.add(
                INodeNo(item.ino),
                next_offset,
                item.kind,
                std::ffi::OsStr::new(&item.name),
            ) {
                break;
            }
        }
        reply.ok();
    }
    fn releasedir(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        _flags: OpenFlags,
        reply: fuser::ReplyEmpty,
    ) {
        let evicted = self
            .state
            .write()
            .unwrap()
            .directory_handles
            .remove(&fh.0)
            .map(|handle| {
                handle
                    .page
                    .into_iter()
                    .map(|item| item.ino)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        self.prune_nodes(evicted);
        reply.ok();
    }
    fn open(
        &self,
        _req: &Request,
        ino: INodeNo,
        flags: OpenFlags,
        _kill_suid_gid: bool,
        reply: ReplyOpen,
    ) {
        let Some(node) = self.node(ino.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        if node.kind != FileType::RegularFile {
            reply.error(Errno::EISDIR);
            return;
        }
        let parent = if node.path == "/" {
            "/"
        } else {
            node.path
                .rsplit_once('/')
                .map(|(p, _)| if p.is_empty() { "/" } else { p })
                .unwrap_or("/")
        };
        let name = node.path.rsplit('/').next().unwrap_or("");
        let node = match self.ensure_child(parent, name) {
            Ok(Some(node)) => node,
            Ok(None) => {
                reply.error(Errno::ENOENT);
                return;
            }
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if node.kind != FileType::RegularFile {
            reply.error(Errno::EISDIR);
            return;
        }
        if node.version_id.is_none() {
            reply.error(Errno::ESTALE);
            return;
        }
        let writable = flags.acc_mode() != OpenAccMode::O_RDONLY;
        if writable {
            match self.open_write_handle(
                node,
                flags.acc_mode() != OpenAccMode::O_WRONLY,
                true,
                false,
            ) {
                Ok(fh) => reply.opened(FileHandle(fh), FopenFlags::FOPEN_DIRECT_IO),
                Err(error) => reply.error(Errno::from_i32(error)),
            }
            return;
        }
        let mut state = self.state.write().unwrap();
        let fh = state.next_handle;
        state.next_handle = state.next_handle.saturating_add(1);
        state.handles.insert(
            fh,
            FileHandleState {
                node,
                writable: false,
                readable: true,
                staged: None,
            },
        );
        reply.opened(FileHandle(fh), FopenFlags::FOPEN_DIRECT_IO);
    }
    fn create(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &std::ffi::OsStr,
        mode: u32,
        umask: u32,
        flags: i32,
        _kill_suid_gid: bool,
        owner: Owner,
        reply: ReplyCreate,
    ) {
        if !self.read_write || !self.capabilities.supports("openWrite") {
            reply.error(Errno::EROFS);
            return;
        }
        if req.uid().is_some_and(|uid| uid != owner.uid) {
            reply.error(Errno::EACCES);
            return;
        }
        let Some(parent_node) = self.node(parent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let (path, file_name) = match Self::child_path(&parent_node, name) {
            Ok(path) => path,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if !self.can_write_path(&path) {
            reply.error(Errno::EACCES);
            return;
        }
        let existing = match self.ensure_child(&parent_node.path, &file_name) {
            Ok(entry) => entry,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if existing.is_some() && flags & libc::O_EXCL != 0 {
            reply.error(Errno::EEXIST);
            return;
        }
        let _listing = self.list_lock.lock().unwrap();
        let is_new = existing.is_none();
        let mut node = existing.unwrap_or_else(|| Node {
            ino: 0,
            path: path.clone(),
            name: file_name,
            kind: FileType::RegularFile,
            size: 0,
            mtime_ms: 0,
            version_id: None,
            read_only: false,
            observed_at: Instant::now(),
            mode: (mode & !umask & 0o777) as u16,
            uid: owner.uid,
            gid: owner.gid,
        });
        if node.kind != FileType::RegularFile {
            reply.error(Errno::EISDIR);
            return;
        }
        let readable = flags & libc::O_ACCMODE != libc::O_WRONLY;
        let fh = match self.open_write_handle(
            node.clone(),
            readable,
            flags & libc::O_ACCMODE != libc::O_RDONLY,
            is_new,
        ) {
            Ok(fh) => fh,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if is_new {
            node = self.insert_node(node);
            if let Some(handle) = self.state.write().unwrap().handles.get_mut(&fh) {
                handle.node = node.clone();
            }
        }
        if flags & libc::O_TRUNC != 0 && !is_new {
            match self.truncate_stage(fh, 0) {
                Ok(updated) => node = updated,
                Err(error) => {
                    reply.error(Errno::from_i32(error));
                    return;
                }
            }
        }
        self.note_lookup(node.ino);
        reply.created(
            &TTL,
            &self.attr(&node),
            Generation(0),
            FileHandle(fh),
            FopenFlags::FOPEN_DIRECT_IO,
        );
    }
    fn write(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        offset: u64,
        data: &[u8],
        _write_flags: WriteFlags,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        reply: ReplyWrite,
    ) {
        if data.len() > MAX_WRITE.min(self.capabilities.max_write_bytes) {
            reply.error(Errno::EINVAL);
            return;
        }
        if offset
            .checked_add(data.len() as u64)
            .is_none_or(|end| end > MAX_SAFE_INTEGER)
        {
            reply.error(Errno::EINVAL);
            return;
        }
        if data.is_empty() {
            reply.written(0);
            return;
        }
        let Some(handle) = self.state.read().unwrap().handles.get(&fh.0).cloned() else {
            reply.error(Errno::EBADF);
            return;
        };
        if !handle.writable {
            reply.error(Errno::EBADF);
            return;
        }
        let Some(stage) = handle.staged else {
            reply.error(Errno::EROFS);
            return;
        };
        if handle.node.read_only
            || !self.capabilities.supports("write")
            || !self.can_write_path(&handle.node.path)
        {
            reply.error(Errno::EACCES);
            return;
        }
        let written = match self
            .bridge
            .lock()
            .unwrap()
            .write(&stage.handle_id, offset, data)
        {
            Ok(written) => written,
            Err(error) => {
                self.update_recovery_path(fh.0, &error);
                reply.error(Errno::from_i32(Self::errno(error)));
                return;
            }
        };
        let mut state = self.state.write().unwrap();
        let Some(current) = state.handles.get_mut(&fh.0) else {
            reply.error(Errno::EBADF);
            return;
        };
        current.node.size = current.node.size.max(offset.saturating_add(written as u64));
        current.node.observed_at = Instant::now();
        if let Some(stage) = current.staged.as_mut() {
            stage.dirty = true;
        }
        let updated = current.node.clone();
        state.nodes.insert(updated.ino, updated);
        reply.written(written as u32);
    }
    fn flush(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        _lock_owner: LockOwner,
        reply: ReplyEmpty,
    ) {
        match self.flush_stage(fh.0) {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(Errno::from_i32(error)),
        }
    }
    fn fsync(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        _datasync: bool,
        reply: ReplyEmpty,
    ) {
        match self.flush_stage(fh.0) {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(Errno::from_i32(error)),
        }
    }
    fn setattr(
        &self,
        _req: &Request,
        ino: INodeNo,
        mode: Option<u32>,
        uid: Option<u32>,
        gid: Option<u32>,
        size: Option<u64>,
        _atime: Option<TimeOrNow>,
        _mtime: Option<TimeOrNow>,
        _ctime: Option<std::time::SystemTime>,
        fh: Option<FileHandle>,
        _crtime: Option<std::time::SystemTime>,
        _chgtime: Option<std::time::SystemTime>,
        _bkuptime: Option<std::time::SystemTime>,
        _flags: Option<fuser::BsdFileFlags>,
        _kill_suid_gid: bool,
        reply: ReplyAttr,
    ) {
        if mode.is_some() || uid.is_some() || gid.is_some() {
            reply.error(Errno::EPERM);
            return;
        }
        let node = if let Some(size) = size {
            let opened_here = if let Some(fh) = fh {
                Some((fh.0, false))
            } else {
                let existing_stage = self
                    .state
                    .read()
                    .unwrap()
                    .handles
                    .iter()
                    .find(|(_, handle)| handle.node.ino == ino.0 && handle.staged.is_some())
                    .map(|(fh, _)| *fh);
                if let Some(fh) = existing_stage {
                    Some((fh, false))
                } else {
                    let Some(node) = self.node(ino.0) else {
                        reply.error(Errno::ENOENT);
                        return;
                    };
                    if node.version_id.is_none() {
                        reply.error(Errno::ESTALE);
                        return;
                    }
                    match self.open_write_handle(node, true, true, false) {
                        Ok(fh) => Some((fh, true)),
                        Err(error) => {
                            reply.error(Errno::from_i32(error));
                            return;
                        }
                    }
                }
            };
            let Some((fh, opened_here)) = opened_here else {
                reply.error(Errno::EBADF);
                return;
            };
            let node = match self.truncate_stage(fh, size) {
                Ok(node) => node,
                Err(error) => {
                    reply.error(Errno::from_i32(error));
                    return;
                }
            };
            if opened_here {
                if let Err(error) = self.flush_stage(fh) {
                    reply.error(Errno::from_i32(error));
                    return;
                }
                let handle_id = self
                    .state
                    .read()
                    .unwrap()
                    .handles
                    .get(&fh)
                    .and_then(|handle| handle.staged.as_ref())
                    .map(|stage| stage.handle_id.clone());
                let Some(handle_id) = handle_id else {
                    reply.error(Errno::EBADF);
                    return;
                };
                let release_result = self.bridge.lock().unwrap().release(&handle_id);
                if let Err(error) = release_result {
                    self.update_recovery_path(fh, &error);
                    reply.error(Errno::from_i32(Self::errno(error)));
                    return;
                }
                self.state.write().unwrap().handles.remove(&fh);
            }
            self.node(ino.0).unwrap_or(node)
        } else if let Some(fh) = fh {
            let node = self
                .state
                .read()
                .unwrap()
                .handles
                .get(&fh.0)
                .map(|handle| handle.node.clone())
                .or_else(|| self.node(ino.0));
            let Some(node) = node else {
                reply.error(Errno::ENOENT);
                return;
            };
            node
        } else if let Some(node) = self.node(ino.0) {
            node
        } else {
            reply.error(Errno::ENOENT);
            return;
        };
        reply.attr(&TTL, &self.attr(&node));
    }
    fn mkdir(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &std::ffi::OsStr,
        mode: u32,
        umask: u32,
        owner: Owner,
        reply: ReplyEntry,
    ) {
        if !self.read_write || !self.capabilities.write {
            reply.error(Errno::EROFS);
            return;
        }
        if req.uid().is_some_and(|uid| uid != owner.uid) {
            reply.error(Errno::EACCES);
            return;
        }
        if !self.capabilities.supports("mkdir") {
            reply.error(Errno::EROFS);
            return;
        }
        let Some(parent_node) = self.node(parent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let (path, file_name) = match Self::child_path(&parent_node, name) {
            Ok(path) => path,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if !self.can_write_path(&path) || !self.can_change_directory(&parent_node.path) {
            reply.error(Errno::EACCES);
            return;
        }
        match self.ensure_child(&parent_node.path, &file_name) {
            Ok(Some(_)) => {
                reply.error(Errno::EEXIST);
                return;
            }
            Ok(None) => {}
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        }
        let _listing = self.list_lock.lock().unwrap();
        if let Err(error) = self.bridge.lock().unwrap().mkdir(&path) {
            reply.error(Errno::from_i32(Self::errno(error)));
            return;
        }
        let node = self.insert_node(Node {
            ino: 0,
            path: path.clone(),
            name: file_name,
            kind: FileType::Directory,
            size: 0,
            mtime_ms: 0,
            version_id: None,
            read_only: false,
            observed_at: Instant::now(),
            mode: (mode & !umask & 0o777) as u16,
            uid: owner.uid,
            gid: owner.gid,
        });
        self.refresh_parent(&path);
        self.note_lookup(node.ino);
        reply.entry(&TTL, &self.attr(&node), Generation(0));
    }
    fn rmdir(&self, _req: &Request, parent: INodeNo, name: &std::ffi::OsStr, reply: ReplyEmpty) {
        if !self.read_write {
            reply.error(Errno::EROFS);
            return;
        }
        if !self.capabilities.delete || !self.capabilities.supports("rmdir") {
            reply.error(Errno::EACCES);
            return;
        }
        let Some(parent_node) = self.node(parent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let (path, file_name) = match Self::child_path(&parent_node, name) {
            Ok(path) => path,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if !self.can_write_path(&path) {
            reply.error(Errno::EACCES);
            return;
        }
        let target = match self.ensure_child(&parent_node.path, &file_name) {
            Ok(Some(node)) => node,
            Ok(None) => {
                reply.error(Errno::ENOENT);
                return;
            }
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if target.kind != FileType::Directory {
            reply.error(Errno::ENOTDIR);
            return;
        }
        let _listing = self.list_lock.lock().unwrap();
        match self.bridge.lock().unwrap().rmdir(&path) {
            Ok(()) => {
                self.remove_node_path(&path);
                reply.ok();
            }
            Err(error) => reply.error(Errno::from_i32(Self::errno(error))),
        }
    }
    fn unlink(&self, _req: &Request, parent: INodeNo, name: &std::ffi::OsStr, reply: ReplyEmpty) {
        if !self.read_write {
            reply.error(Errno::EROFS);
            return;
        }
        if !self.capabilities.delete || !self.capabilities.supports("unlink") {
            reply.error(Errno::EACCES);
            return;
        }
        let Some(parent_node) = self.node(parent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let (path, file_name) = match Self::child_path(&parent_node, name) {
            Ok(path) => path,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if !self.can_write_path(&path) {
            reply.error(Errno::EACCES);
            return;
        }
        let target = match self.ensure_child(&parent_node.path, &file_name) {
            Ok(Some(node)) => node,
            Ok(None) => {
                reply.error(Errno::ENOENT);
                return;
            }
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if target.kind == FileType::Directory {
            reply.error(Errno::EISDIR);
            return;
        }
        let version_id = match self.version_guard_for_node(&target) {
            Ok(version_id) => version_id,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        let _listing = self.list_lock.lock().unwrap();
        match self.bridge.lock().unwrap().unlink(&path, &version_id) {
            Ok(()) => {
                if let Some(stage_id) = version_id.strip_prefix("staged:") {
                    for handle in self.state.write().unwrap().handles.values_mut() {
                        if let Some(stage) = handle
                            .staged
                            .as_mut()
                            .filter(|stage| stage.handle_id == stage_id)
                        {
                            stage.dirty = false;
                        }
                    }
                }
                self.remove_node_path(&path);
                reply.ok();
            }
            Err(error) => reply.error(Errno::from_i32(Self::errno(error))),
        }
    }
    fn rename(
        &self,
        _req: &Request,
        parent: INodeNo,
        name: &std::ffi::OsStr,
        newparent: INodeNo,
        newname: &std::ffi::OsStr,
        flags: RenameFlags,
        _owner: Option<Owner>,
        reply: ReplyEmpty,
    ) {
        if !self.read_write || !self.capabilities.supports("rename") {
            reply.error(Errno::EROFS);
            return;
        }
        if flags.bits() & !RenameFlags::RENAME_NOREPLACE.bits() != 0 {
            reply.error(Errno::EINVAL);
            return;
        }
        let Some(parent_node) = self.node(parent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let Some(new_parent_node) = self.node(newparent.0) else {
            reply.error(Errno::ENOENT);
            return;
        };
        let (source_path, source_name) = match Self::child_path(&parent_node, name) {
            Ok(path) => path,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        let (destination_path, destination_name) = match Self::child_path(&new_parent_node, newname)
        {
            Ok(path) => path,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if source_path == destination_path {
            reply.ok();
            return;
        }
        if !self.can_write_path(&source_path)
            || !self.can_write_path(&destination_path)
            || !self.can_change_directory(&parent_node.path)
            || !self.can_change_directory(&new_parent_node.path)
        {
            reply.error(Errno::EACCES);
            return;
        }
        let source = match self.ensure_child(&parent_node.path, &source_name) {
            Ok(Some(node)) => node,
            Ok(None) => {
                reply.error(Errno::ENOENT);
                return;
            }
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if source.kind != FileType::RegularFile {
            reply.error(Errno::EISDIR);
            return;
        }
        let destination = match self.ensure_child(&new_parent_node.path, &destination_name) {
            Ok(node) => node,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        if flags.contains(RenameFlags::RENAME_NOREPLACE) && destination.is_some() {
            reply.error(Errno::EEXIST);
            return;
        }
        if destination
            .as_ref()
            .is_some_and(|node| node.kind != FileType::RegularFile)
        {
            reply.error(Errno::EISDIR);
            return;
        }
        if destination.is_some() && !self.capabilities.delete {
            reply.error(Errno::EACCES);
            return;
        }
        let source_version = match self.version_guard_for_node(&source) {
            Ok(version) => version,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        let destination_version = match destination.as_ref() {
            Some(node) => match self.version_guard_for_node(node) {
                Ok(version) => Some(version),
                Err(error) => {
                    reply.error(Errno::from_i32(error));
                    return;
                }
            },
            None => None,
        };
        let operation_id = match self.next_operation_id() {
            Ok(operation_id) => operation_id,
            Err(error) => {
                reply.error(Errno::from_i32(error));
                return;
            }
        };
        let _listing = self.list_lock.lock().unwrap();
        let renamed = match self.bridge.lock().unwrap().rename(
            &source_path,
            &destination_path,
            &source_version,
            destination_version.as_deref(),
            &operation_id,
        ) {
            Ok(entry) => entry,
            Err(error) => {
                reply.error(Errno::from_i32(Self::errno(error)));
                return;
            }
        };
        let destination_ino = destination.as_ref().map(|node| node.ino);
        let source_stage_id = source_version.strip_prefix("staged:").map(str::to_owned);
        let destination_stage_id = destination_version
            .as_deref()
            .and_then(|version| version.strip_prefix("staged:"))
            .map(str::to_owned);
        {
            let mut state = self.state.write().unwrap();
            state.paths.remove(&source_path);
            if destination_ino.is_some() {
                state.paths.remove(&destination_path);
            }
            let mut moved = state
                .nodes
                .get(&source.ino)
                .cloned()
                .unwrap_or(source.clone());
            moved.path = destination_path.clone();
            moved.name = destination_name;
            moved.observed_at = Instant::now();
            moved.mode = self.entry_mode(&moved.path, moved.kind, moved.read_only);
            moved.version_id = renamed
                .as_ref()
                .and_then(|entry| entry.get("versionId"))
                .and_then(|value| value.as_str())
                .map(str::to_owned);
            if let Some(entry) = renamed.as_ref() {
                if let Some(size) = entry.get("size").and_then(|value| value.as_u64()) {
                    moved.size = size;
                }
                if let Some(mtime) = entry.get("mtimeMs").and_then(|value| value.as_i64()) {
                    moved.mtime_ms = mtime;
                }
            }
            state.paths.insert(destination_path.clone(), source.ino);
            state.nodes.insert(source.ino, moved.clone());
            Self::retarget_open_handles(&mut state, source.ino, &moved, source_stage_id.as_deref());
            for handle in state.handles.values_mut() {
                if destination_ino == Some(handle.node.ino) {
                    if let Some(stage) = handle.staged.as_mut().filter(|stage| {
                        destination_stage_id.as_deref() == Some(stage.handle_id.as_str())
                    }) {
                        stage.dirty = false;
                    }
                }
            }
        }
        self.refresh_parent(&source_path);
        self.refresh_parent(&destination_path);
        if let Some(ino) = destination_ino {
            self.prune_nodes([ino]);
        }
        reply.ok();
    }
    fn read(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        offset: u64,
        size: u32,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        reply: ReplyData,
    ) {
        if size as usize > MAX_READ.min(self.capabilities.max_read_bytes) {
            reply.error(Errno::EINVAL);
            return;
        }
        if offset
            .checked_add(size as u64)
            .is_none_or(|end| end > MAX_SAFE_INTEGER)
        {
            reply.error(Errno::EINVAL);
            return;
        }
        let Some(handle) = self.state.read().unwrap().handles.get(&fh.0).cloned() else {
            reply.error(Errno::EBADF);
            return;
        };
        if !handle.readable {
            reply.error(Errno::EACCES);
            return;
        }
        if let Some(stage) = handle.staged.as_ref() {
            if !self.capabilities.supports("readStaged") {
                reply.error(Errno::EROFS);
                return;
            }
            let result =
                self.bridge
                    .lock()
                    .unwrap()
                    .read_staged(&stage.handle_id, offset, size as usize);
            match result {
                Ok((data, _eof)) => reply.data(&data),
                Err(error) => reply.error(Errno::from_i32(Self::errno(error))),
            }
            return;
        }
        let Some(version) = handle.node.version_id.as_deref() else {
            reply.error(Errno::ESTALE);
            return;
        };
        if !self.capabilities.supports("read") {
            reply.error(Errno::EROFS);
            return;
        }
        match self
            .bridge
            .lock()
            .unwrap()
            .read(&handle.node.path, version, offset, size as usize)
        {
            Ok(data) => reply.data(&data),
            Err(e) => reply.error(Errno::from_i32(Self::errno(e))),
        }
    }
    fn release(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        _flush: bool,
        reply: fuser::ReplyEmpty,
    ) {
        match self.finish_release(fh.0) {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(Errno::from_i32(error)),
        }
    }
    fn forget(&self, _req: &Request, ino: INodeNo, nlookup: u64) {
        if ino.0 == ROOT_INO {
            return;
        }
        let mut state = self.state.write().unwrap();
        let refs = state.lookup_refs.get(&ino.0).copied().unwrap_or(0);
        if refs <= nlookup {
            state.lookup_refs.remove(&ino.0);
        } else {
            state.lookup_refs.insert(ino.0, refs - nlookup);
        }
        drop(state);
        self.prune_nodes([ino.0]);
    }
}

pub fn check_mountpoint(path: &std::path::Path, uid: u32) -> std::io::Result<std::path::PathBuf> {
    use std::os::unix::fs::MetadataExt;
    if !path.is_absolute() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "mountpoint must be absolute",
        ));
    }
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component);
        let m = std::fs::symlink_metadata(&current)?;
        if m.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "symlink mountpoint is not allowed",
            ));
        }
    }
    let canonical = std::fs::canonicalize(path)?;
    let meta = std::fs::metadata(&canonical)?;
    if !meta.is_dir() || meta.uid() != uid {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "mountpoint must be a directory owned by the caller",
        ));
    }
    if std::fs::read_dir(&canonical)?.next().is_some() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::DirectoryNotEmpty,
            "mountpoint must be empty",
        ));
    }
    let mounts = std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default();
    let mountinfo_path = mountinfo_escape_path(&canonical.to_string_lossy());
    if mounts
        .lines()
        .any(|line| line.split_whitespace().nth(4) == Some(mountinfo_path.as_str()))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "mountpoint is already mounted",
        ));
    }
    Ok(canonical)
}

fn mountinfo_escape_path(path: &str) -> String {
    path.replace('\\', "\\134")
        .replace(' ', "\\040")
        .replace('\t', "\\011")
        .replace('\n', "\\012")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;
    #[test]
    fn rename_keeps_open_readers_pinned_to_their_original_version() {
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(Vec::<u8>::new())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        let now = Instant::now();
        let source_v1 = Node {
            ino: 2,
            path: "/.edit.tmp".into(),
            name: ".edit.tmp".into(),
            kind: FileType::RegularFile,
            size: 4,
            mtime_ms: 100,
            version_id: Some("v1".into()),
            read_only: false,
            observed_at: now,
            mode: 0o600,
            uid: 1000,
            gid: 1000,
        };
        let source_v2 = Node {
            size: 8,
            mtime_ms: 200,
            version_id: Some("v2".into()),
            ..source_v1.clone()
        };
        let destination_v1 = Node {
            ino: 3,
            path: "/document.txt".into(),
            name: "document.txt".into(),
            size: 3,
            version_id: Some("destination-v1".into()),
            ..source_v1.clone()
        };
        let moved_source = Node {
            path: "/document.txt".into(),
            name: "document.txt".into(),
            observed_at: Instant::now(),
            ..source_v2.clone()
        };
        {
            let mut state = fs.state.write().unwrap();
            state.nodes.insert(source_v2.ino, source_v2.clone());
            state
                .nodes
                .insert(destination_v1.ino, destination_v1.clone());
            state.handles.insert(
                10,
                FileHandleState {
                    node: source_v1,
                    writable: false,
                    readable: true,
                    staged: None,
                },
            );
            state.handles.insert(
                11,
                FileHandleState {
                    node: destination_v1,
                    writable: false,
                    readable: true,
                    staged: None,
                },
            );
            DriveFs::<std::io::Cursor<Vec<u8>>, Vec<u8>>::retarget_open_handles(
                &mut state,
                source_v2.ino,
                &moved_source,
                None,
            );
        }

        let state = fs.state.read().unwrap();
        let source_handle = &state.handles[&10].node;
        assert_eq!(source_handle.path, "/document.txt");
        assert_eq!(source_handle.version_id.as_deref(), Some("v1"));
        assert_eq!(source_handle.size, 4);
        assert_eq!(source_handle.mtime_ms, 100);
        let destination_handle = &state.handles[&11].node;
        assert_eq!(
            destination_handle.version_id.as_deref(),
            Some("destination-v1")
        );
        assert_eq!(destination_handle.size, 3);
        drop(state);

        let mut bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(
                b"{\"id\":1,\"ok\":true,\"data\":\"djEhIQ==\"}\n",
            )),
            Vec::new(),
        );
        assert_eq!(bridge.read("/document.txt", "v1", 0, 4).unwrap(), b"v1!!");
        let request: serde_json::Value =
            serde_json::from_str(String::from_utf8(bridge.writer).unwrap().trim()).unwrap();
        assert_eq!(request["path"], "/document.txt");
        assert_eq!(request["versionId"], "v1");
    }
    #[test]
    fn mount_activity_is_busy_until_all_file_and_directory_handles_close() {
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(Vec::<u8>::new())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        let activity = fs.mount_activity();
        assert!(activity.is_idle());
        {
            let mut state = fs.state.write().unwrap();
            let root = state.nodes[&ROOT_INO].clone();
            state.handles.insert(
                10,
                FileHandleState {
                    node: root.clone(),
                    writable: false,
                    readable: true,
                    staged: None,
                },
            );
        }
        assert_eq!(activity.open_handle_counts(), (1, 0));
        {
            let mut state = fs.state.write().unwrap();
            state.handles.remove(&10);
        }
        assert!(activity.is_idle());
        {
            let mut state = fs.state.write().unwrap();
            let root = state.nodes[&ROOT_INO].clone();
            state.directory_handles.insert(
                11,
                DirectoryHandleState {
                    ino: root.ino,
                    path: root.path,
                    page_start: 0,
                    page: Vec::new(),
                    next_cursor: None,
                    seen_cursors: HashSet::new(),
                    used_cursors: HashSet::new(),
                    exhausted: false,
                    started: false,
                },
            );
        }
        assert_eq!(activity.open_handle_counts(), (0, 1));
        {
            let mut state = fs.state.write().unwrap();
            state.directory_handles.remove(&11);
        }
        assert!(activity.is_idle());
    }

    #[test]
    fn final_release_after_conflict_retires_handle_and_requests_bridge_release() {
        let input = concat!(
            "{\"id\":1,\"ok\":false,\"errno\":\"ESTALE\",\"recoveryPath\":\"/tmp/agent-drive-stage-1\",\"currentVersionId\":\"remote-v2\"}\n",
            "{\"id\":2,\"ok\":false,\"errno\":\"ESTALE\",\"recoveryPath\":\"/tmp/agent-drive-stage-1\",\"currentVersionId\":\"remote-v2\"}\n"
        );
        let bridge = Bridge::new(BufReader::new(input.as_bytes()), Vec::new());
        let capabilities = MountCapabilities {
            read_only: false,
            write: true,
            delete: false,
            write_paths: vec!["/docs".into()],
            max_read_bytes: MAX_READ,
            max_write_bytes: MAX_WRITE,
            ops: vec!["flush".into(), "release".into()],
        };
        let fs = DriveFs::with_capabilities(bridge, 1000, 1000, capabilities, true);
        let node = Node {
            ino: 2,
            path: "/docs/report.txt".into(),
            name: "report.txt".into(),
            kind: FileType::RegularFile,
            size: 8,
            mtime_ms: 10,
            version_id: Some("remote-v1".into()),
            read_only: false,
            observed_at: Instant::now(),
            mode: 0o600,
            uid: 1000,
            gid: 1000,
        };
        fs.state
            .write()
            .unwrap()
            .nodes
            .insert(node.ino, node.clone());
        fs.state
            .write()
            .unwrap()
            .paths
            .insert(node.path.clone(), node.ino);
        fs.state.write().unwrap().handles.insert(
            77,
            FileHandleState {
                node,
                writable: true,
                readable: true,
                staged: Some(StagedFile {
                    handle_id: "stage-1".into(),
                    recovery_path: Some("/tmp/agent-drive-stage-1".into()),
                    current_version_id: None,
                    dirty: true,
                }),
            },
        );

        assert_eq!(fs.finish_release(77), Err(libc::ESTALE));
        assert!(fs.state.read().unwrap().handles.get(&77).is_none());
        assert!(fs.mount_activity().is_idle());
        let requests: Vec<serde_json::Value> =
            String::from_utf8(fs.bridge.lock().unwrap().writer.clone())
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0]["op"], "flush");
        assert_eq!(requests[1]["op"], "release");
        assert_eq!(requests[1]["handleId"], "stage-1");
    }
    #[test]
    fn operation_ids_are_unique_uuid_v4_values() {
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(Vec::<u8>::new())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        let first = fs.next_operation_id().unwrap();
        let second = fs.next_operation_id().unwrap();
        assert_ne!(first, second, "separate user operations need distinct IDs");
        for id in [&first, &second] {
            let parts: Vec<_> = id.split('-').collect();
            assert_eq!(
                parts.iter().map(|part| part.len()).collect::<Vec<_>>(),
                [8, 4, 4, 4, 12]
            );
            assert!(
                parts
                    .iter()
                    .all(|part| part.bytes().all(|byte| byte.is_ascii_hexdigit()))
            );
            assert_eq!(parts[2].as_bytes()[0], b'4', "operation IDs must be UUIDv4");
            assert!(matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'));
        }
        let mut bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(b"{\"id\":1,\"ok\":true}\n")),
            Vec::new(),
        );
        bridge
            .rename("/source", "/destination", &first, None, &first)
            .unwrap();
        let sent = String::from_utf8(bridge.writer).unwrap();
        let request: serde_json::Value = serde_json::from_str(sent.trim()).unwrap();
        assert_eq!(request["operationId"], first);
    }
    #[test]
    fn canonical_paths_only() {
        assert!(DriveFs::<std::io::Cursor<Vec<u8>>, Vec<u8>>::valid_path(
            "/"
        ));
        assert!(DriveFs::<std::io::Cursor<Vec<u8>>, Vec<u8>>::valid_path(
            "/a/b"
        ));
        for p in ["a", "/a/", "/a//b", "/./x", "/a/../b", "/a\\b"] {
            assert!(
                !DriveFs::<std::io::Cursor<Vec<u8>>, Vec<u8>>::valid_path(p),
                "{p}"
            );
        }
    }
    #[test]
    fn mountinfo_paths_escape_whitespace_and_backslashes() {
        assert_eq!(mountinfo_escape_path("/tmp/a b"), "/tmp/a\\040b");
        assert_eq!(
            mountinfo_escape_path("/tmp/a\\b\tc\nd"),
            "/tmp/a\\134b\\011c\\012d"
        );
    }
    #[test]
    fn mountpoint_rejects_symlinks_and_nonempty_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let nonempty = tmp.path().join("busy");
        std::fs::create_dir(&nonempty).unwrap();
        std::fs::write(nonempty.join("x"), b"x").unwrap();
        assert!(check_mountpoint(&nonempty, unsafe { libc::geteuid() }).is_err());
        let target = tmp.path().join("target");
        std::fs::create_dir(&target).unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(check_mountpoint(&link, unsafe { libc::geteuid() }).is_err());
    }
    #[test]
    fn directory_handle_keeps_its_cursor_across_ttl_and_lookup_finds_listed_files() {
        use serde_json::json;
        let mut wire = String::new();
        for page_number in 0..10 {
            let start = page_number * 100;
            let entries: Vec<_> = (start..start + 100)
                .map(|index| {
                    json!({
                        "name": format!("file-{index:04}"),
                        "kind": "file",
                        "size": 3,
                        "mtimeMs": index,
                        "versionId": format!("v{index}")
                    })
                })
                .collect();
            let next = if page_number == 9 {
                serde_json::Value::Null
            } else {
                json!(format!("c{}", page_number + 1))
            };
            let response = json!({
                "id": page_number + 1,
                "ok": true,
                "entries": entries,
                "nextCursor": next
            });
            wire.push_str(&response.to_string());
            wire.push('\n');
        }
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(wire.into_bytes())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        let handle = FileHandle(99);
        fs.state.write().unwrap().directory_handles.insert(
            99,
            DirectoryHandleState {
                ino: ROOT_INO,
                path: "/".into(),
                page_start: 0,
                page: Vec::new(),
                next_cursor: None,
                seen_cursors: HashSet::new(),
                used_cursors: HashSet::new(),
                exhausted: false,
                started: false,
            },
        );
        for page_number in 0..10 {
            if page_number == 1 {
                std::thread::sleep(Duration::from_millis(1100));
            }
            let page = fs.load_directory_page(handle, page_number * 100).unwrap();
            assert_eq!(page.page_start, page_number * 100);
            assert_eq!(page.page.len(), 100);
            assert_eq!(page.page[0].name, format!("file-{:04}", page_number * 100));
        }
        let requests = String::from_utf8(fs.bridge.lock().unwrap().writer.clone()).unwrap();
        let list_calls: Vec<_> = requests.lines().collect();
        assert_eq!(
            list_calls.len(),
            10,
            "each page should be requested once, despite TTL expiry"
        );
        assert!(list_calls[0].contains("\"op\":\"list\""));
        assert!(!list_calls[0].contains("\"cursor\""));
        assert!(list_calls[1].contains("\"cursor\":\"c1\""));
        assert!(list_calls[9].contains("\"cursor\":\"c9\""));
    }
    #[test]
    fn metadata_pruning_preserves_active_directory_pages_and_lookup_references() {
        use serde_json::json;
        let entry = json!({"name":"held.txt","kind":"file","size":1,"mtimeMs":1,"versionId":"v1"});
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(Vec::<u8>::new())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        let node = fs
            .intern_entries("/", vec![serde_json::from_value(entry).unwrap()])
            .remove(0);
        fs.state.write().unwrap().directory_handles.insert(
            7,
            DirectoryHandleState {
                ino: ROOT_INO,
                path: "/".into(),
                page_start: 0,
                page: vec![DirectoryItem {
                    name: node.name.clone(),
                    ino: node.ino,
                    kind: node.kind,
                }],
                next_cursor: None,
                seen_cursors: HashSet::new(),
                used_cursors: HashSet::new(),
                exhausted: true,
                started: true,
            },
        );
        fs.prune_nodes([node.ino]);
        assert!(
            fs.node(node.ino).is_some(),
            "an active readdir page keeps its entries alive"
        );
        fs.state.write().unwrap().directory_handles.remove(&7);
        fs.note_lookup(node.ino);
        fs.prune_nodes([node.ino]);
        assert!(
            fs.node(node.ino).is_some(),
            "kernel lookup references keep inodes alive"
        );
        fs.state.write().unwrap().lookup_refs.remove(&node.ino);
        fs.prune_nodes([node.ino]);
        assert!(fs.node(node.ino).is_none());
        assert!(!fs.state.read().unwrap().paths.contains_key("/held.txt"));

        let directory = fs
            .intern_entries(
                "/",
                vec![
                    serde_json::from_value(json!({
                        "name": "open-dir",
                        "kind": "directory",
                        "size": 0,
                        "mtimeMs": 1
                    }))
                    .unwrap(),
                ],
            )
            .remove(0);
        fs.state.write().unwrap().directory_handles.insert(
            8,
            DirectoryHandleState {
                ino: directory.ino,
                path: directory.path.clone(),
                page_start: 0,
                page: Vec::new(),
                next_cursor: None,
                seen_cursors: HashSet::new(),
                used_cursors: HashSet::new(),
                exhausted: false,
                started: false,
            },
        );
        fs.prune_nodes([directory.ino]);
        assert!(
            fs.node(directory.ino).is_some(),
            "an open directory handle keeps its inode alive"
        );
        fs.state.write().unwrap().directory_handles.remove(&8);
        fs.prune_nodes([directory.ino]);
        assert!(fs.node(directory.ino).is_none());
    }
    #[test]
    fn separate_directory_handles_keep_independent_cursors() {
        use serde_json::json;
        let mut wire = String::new();
        for id in 1..=4 {
            let response = json!({
                "id": id,
                "ok": true,
                "entries": [{"name": format!("file-{id}"), "kind": "file", "size": 1, "mtimeMs": id, "versionId": format!("v{id}")}],
                "nextCursor": if id <= 2 { json!("next") } else { serde_json::Value::Null }
            });
            wire.push_str(&response.to_string());
            wire.push('\n');
        }
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(wire.into_bytes())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        for handle in [10, 20] {
            fs.state.write().unwrap().directory_handles.insert(
                handle,
                DirectoryHandleState {
                    ino: ROOT_INO,
                    path: "/".into(),
                    page_start: 0,
                    page: Vec::new(),
                    next_cursor: None,
                    seen_cursors: HashSet::new(),
                    used_cursors: HashSet::new(),
                    exhausted: false,
                    started: false,
                },
            );
        }
        assert_eq!(
            fs.load_directory_page(FileHandle(10), 0).unwrap().page[0].name,
            "file-1"
        );
        assert_eq!(
            fs.load_directory_page(FileHandle(20), 0).unwrap().page[0].name,
            "file-2"
        );
        assert_eq!(
            fs.load_directory_page(FileHandle(10), 1).unwrap().page[0].name,
            "file-3"
        );
        assert_eq!(
            fs.load_directory_page(FileHandle(20), 1).unwrap().page[0].name,
            "file-4"
        );
    }
    #[test]
    fn lookup_after_paged_readdir_finds_a_previously_listed_file() {
        use serde_json::json;
        let response = json!({
            "id": 1,
            "ok": true,
            "entries": [
                {"name": "empty.bin", "kind": "file", "size": 0, "mtimeMs": 1, "versionId": "v-empty"},
                {"name": "note.txt", "kind": "file", "size": 2, "mtimeMs": 1, "versionId": "v-note"}
            ],
            "nextCursor": null
        }).to_string() + "\n";
        let bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(response.into_bytes())),
            Vec::new(),
        );
        let fs = DriveFs::new(bridge, unsafe { libc::geteuid() }, unsafe {
            libc::getegid()
        });
        fs.state.write().unwrap().directory_handles.insert(
            7,
            DirectoryHandleState {
                ino: ROOT_INO,
                path: "/".into(),
                page_start: 0,
                page: Vec::new(),
                next_cursor: None,
                seen_cursors: HashSet::new(),
                used_cursors: HashSet::new(),
                exhausted: false,
                started: false,
            },
        );
        let listing = fs.load_directory_page(FileHandle(7), 0).unwrap();
        assert_eq!(listing.page.len(), 2);
        let file = fs.ensure_child("/", "empty.bin").unwrap().unwrap();
        assert_eq!(file.version_id.as_deref(), Some("v-empty"));
        assert_eq!(
            String::from_utf8(fs.bridge.lock().unwrap().writer.clone())
                .unwrap()
                .lines()
                .count(),
            1
        );
    }
    #[test]
    fn bridge_lists_pages_and_reads_version_pinned_bounded_bytes() {
        let input=b"{\"id\":1,\"ok\":true,\"entries\":[{\"name\":\"a\",\"kind\":\"file\",\"size\":3,\"mtimeMs\":4,\"versionId\":\"v1\"}],\"nextCursor\":\"next\"}\n{\"id\":2,\"ok\":true,\"entries\":[],\"nextCursor\":null}\n{\"id\":3,\"ok\":true,\"data\":\"YWJj\"}\n".to_vec();
        let mut b = Bridge::new(BufReader::new(std::io::Cursor::new(input)), Vec::new());
        let p = b.list("/", None).unwrap();
        assert_eq!(p.entries[0].version_id.as_deref(), Some("v1"));
        assert_eq!(p.next_cursor.as_deref(), Some("next"));
        assert!(
            b.list("/", p.next_cursor.as_deref())
                .unwrap()
                .entries
                .is_empty()
        );
        assert_eq!(b.read("/a", "v1", 0, 3).unwrap(), b"abc");
        let sent = String::from_utf8(b.writer).unwrap();
        assert!(sent.contains("\"op\":\"read\""));
        assert!(sent.contains("\"versionId\":\"v1\""));
    }

    #[test]
    fn per_entry_read_only_disables_file_writes_without_disabling_parent_creation() {
        let legacy_entry: Entry = serde_json::from_str(
            r#"{"name":"legacy.txt","kind":"file","size":3,"mtimeMs":4,"versionId":"v1"}"#,
        )
        .unwrap();
        assert!(!legacy_entry.read_only);
        assert!(serde_json::to_value(&legacy_entry)
            .unwrap()
            .get("readOnly")
            .is_none());

        let input = b"{\"id\":1,\"ok\":true,\"entries\":[{\"name\":\"locked.txt\",\"kind\":\"file\",\"size\":3,\"mtimeMs\":4,\"versionId\":\"v1\",\"readOnly\":true}],\"nextCursor\":null}\n";
        let bridge = Bridge::new(BufReader::new(&input[..]), Vec::new());
        let capabilities = MountCapabilities {
            read_only: false,
            write: true,
            delete: false,
            write_paths: vec!["/".into()],
            max_read_bytes: MAX_READ,
            max_write_bytes: MAX_WRITE,
            ops: vec!["openWrite".into(), "write".into()],
        };
        let fs = DriveFs::with_capabilities(bridge, 1000, 1000, capabilities, true);
        let locked = fs.ensure_child("/", "locked.txt").unwrap().unwrap();

        assert!(locked.read_only);
        assert_eq!(locked.mode, 0o400);
        assert_eq!(fs.node(ROOT_INO).unwrap().mode, 0o700);
        assert!(fs.can_write_path("/new-sibling.txt"));
        assert_eq!(
            fs.open_write_handle(locked, true, true, false),
            Err(libc::EROFS)
        );
        assert_eq!(
            String::from_utf8(fs.bridge.lock().unwrap().writer.clone())
                .unwrap()
                .lines()
                .count(),
            1,
            "the read-only open must not send openWrite"
        );
    }

    #[test]
    fn absent_per_entry_read_only_preserves_existing_write_behavior() {
        let input = concat!(
            "{\"id\":1,\"ok\":true,\"entries\":[{\"name\":\"normal.txt\",\"kind\":\"file\",\"size\":3,\"mtimeMs\":4,\"versionId\":\"v1\"}],\"nextCursor\":null}\n",
            "{\"id\":2,\"ok\":true,\"handleId\":\"stage-1\",\"size\":3}\n"
        );
        let bridge = Bridge::new(BufReader::new(input.as_bytes()), Vec::new());
        let capabilities = MountCapabilities {
            read_only: false,
            write: true,
            delete: false,
            write_paths: vec!["/".into()],
            max_read_bytes: MAX_READ,
            max_write_bytes: MAX_WRITE,
            ops: vec!["openWrite".into(), "write".into()],
        };
        let fs = DriveFs::with_capabilities(bridge, 1000, 1000, capabilities, true);
        let normal = fs.ensure_child("/", "normal.txt").unwrap().unwrap();

        assert!(!normal.read_only);
        assert_eq!(normal.mode, 0o600);
        assert!(fs.open_write_handle(normal, true, true, false).is_ok());
        let requests: Vec<serde_json::Value> = String::from_utf8(fs.bridge.lock().unwrap().writer.clone())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(requests[1]["op"], "openWrite");
    }

    #[test]
    fn bridge_negotiates_capabilities_and_preserves_staged_write_protocol() {
        let input = concat!(
            "{\"id\":1,\"ok\":true,\"capabilities\":{\"readOnly\":false,\"write\":true,\"delete\":true,\"writePaths\":[\"/docs\"],\"maxReadBytes\":1048576,\"maxWriteBytes\":1048576,\"ops\":[\"read\",\"openWrite\",\"write\",\"truncate\",\"readStaged\",\"flush\",\"release\"]}}\n",
            "{\"id\":2,\"ok\":true,\"handleId\":\"stage-7\",\"recoveryPath\":\"/tmp/agent-drive-stage-7\",\"size\":3}\n",
            "{\"id\":3,\"ok\":true,\"bytesWritten\":2}\n",
            "{\"id\":4,\"ok\":true,\"size\":5}\n",
            "{\"id\":5,\"ok\":true,\"data\":\"aGVsbG8=\",\"eof\":true}\n",
            "{\"id\":6,\"ok\":true,\"version\":{\"id\":\"v2\",\"path\":\"/docs/a.txt\"}}\n",
            "{\"id\":7,\"ok\":true}\n",
        );
        let mut bridge = Bridge::new(BufReader::new(input.as_bytes()), Vec::new());

        let capabilities = bridge.capabilities().unwrap();
        assert!(capabilities.write && capabilities.delete && !capabilities.read_only);
        assert_eq!(capabilities.write_paths, vec!["/docs"]);
        assert_eq!(capabilities.max_write_bytes, MAX_WRITE);

        let opened = bridge.open_write("/docs/a.txt", Some("v1")).unwrap();
        assert_eq!(opened.handle_id, "stage-7");
        assert_eq!(opened.size, 3);
        assert_eq!(
            opened.recovery_path.as_deref(),
            Some("/tmp/agent-drive-stage-7")
        );
        assert_eq!(bridge.write("stage-7", 1, b"hi").unwrap(), 2);
        assert_eq!(bridge.truncate("stage-7", 5).unwrap(), 5);
        let (staged, eof) = bridge.read_staged("stage-7", 0, 8).unwrap();
        assert_eq!(staged, b"hello");
        assert!(eof);
        let version = bridge.flush("stage-7").unwrap();
        assert_eq!(version.id, "v2");
        bridge.release("stage-7").unwrap();

        let sent = String::from_utf8(bridge.writer).unwrap();
        let requests: Vec<serde_json::Value> = sent
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(requests.len(), 7);
        assert_eq!(requests[0]["op"], "capabilities");
        assert_eq!(requests[1]["op"], "openWrite");
        assert_eq!(requests[1]["path"], "/docs/a.txt");
        assert_eq!(requests[1]["baseVersionId"], "v1");
        assert_eq!(requests[2]["data"], "aGk=");
        assert_eq!(requests[2]["offset"], 1);
        assert_eq!(requests[3]["op"], "truncate");
        assert_eq!(requests[4]["op"], "readStaged");
        assert_eq!(requests[5]["op"], "flush");
        assert_eq!(requests[6]["op"], "release");
    }

    #[test]
    fn bridge_rejects_oversized_write_before_sending_it() {
        let mut bridge = Bridge::new(
            BufReader::new(std::io::Cursor::new(Vec::<u8>::new())),
            Vec::new(),
        );
        let too_large = vec![0u8; MAX_WRITE + 1];
        assert!(matches!(
            bridge.write("stage-1", 0, &too_large),
            Err(MountError::InvalidResponse)
        ));
        assert!(bridge.writer.is_empty());
    }

    #[test]
    fn bridge_preserves_recovery_details_on_flush_conflict() {
        let input = concat!(
            "{\"id\":1,\"ok\":false,\"errno\":\"ESTALE\",\"recoveryPath\":\"/tmp/agent-drive-stage-1\",\"currentVersionId\":\"v-current\"}\n"
        );
        let mut bridge = Bridge::new(BufReader::new(input.as_bytes()), Vec::new());
        let error = bridge.flush("stage-1").unwrap_err();
        match error {
            MountError::Remote {
                errno,
                recovery_path,
                current_version_id,
            } => {
                assert_eq!(errno, "ESTALE");
                assert_eq!(recovery_path.as_deref(), Some("/tmp/agent-drive-stage-1"));
                assert_eq!(current_version_id.as_deref(), Some("v-current"));
            }
            error => panic!("expected remote conflict, received {error:?}"),
        }
    }

    #[test]
    fn write_scope_matches_only_the_allowed_directory_tree() {
        let capabilities = MountCapabilities {
            read_only: false,
            write: true,
            delete: false,
            write_paths: vec!["/docs".into()],
            max_read_bytes: MAX_READ,
            max_write_bytes: MAX_WRITE,
            ops: Vec::new(),
        };
        assert!(capabilities.can_write_path("/docs"));
        assert!(capabilities.can_write_path("/docs/nested/file.txt"));
        assert!(!capabilities.can_write_path("/docs-archive/file.txt"));
        assert!(capabilities.can_change_directory("/"));
        assert!(capabilities.can_change_directory("/docs/nested"));
        assert!(!capabilities.can_change_directory("/archive"));
    }
}
