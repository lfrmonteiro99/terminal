//! RAII guards for daemon-wide concurrency maps (issue #103, Minor3b).
//!
//! `do_start_run` registers the run in two shared maps (concurrency by
//! project root, active runs by session uuid) and used to remove entries by
//! hand on every early-return path. That is fragile — missing a cleanup
//! site leaks the entry forever and permanently blocks the repo.
//!
//! These guards own the map key and drop it automatically on scope exit.
//! `DaemonContext` stores the maps behind a `tokio::sync::Mutex`, so `Drop`
//! can't `.await`. We spawn a tiny removal task instead; contention is
//! minimal (insert/remove only) and the spawn cost is negligible.
//!
//! Usage:
//! ```ignore
//! let Some(_concurrency) =
//!     ConcurrencyGuard::acquire(ctx.concurrency.clone(), project_root.clone(), run_id).await
//! else {
//!     // already in use — emit error and return; no manual cleanup needed
//! };
//! // ...early returns are safe; the guard drops and removes the entry.
//! ```

use std::collections::HashMap;
use std::hash::Hash;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Generic RAII guard that removes `key` from `map` on drop.
pub struct MapKeyGuard<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Send + 'static,
{
    map: Arc<Mutex<HashMap<K, V>>>,
    key: Option<K>,
}

impl<K, V> MapKeyGuard<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Send + 'static,
{
    /// Try to insert `(key, value)`. Returns `None` if the key already exists
    /// (caller should report a conflict error and bail). On success, the
    /// returned guard removes the key when dropped.
    pub async fn acquire(map: Arc<Mutex<HashMap<K, V>>>, key: K, value: V) -> Option<Self> {
        let mut m = map.lock().await;
        if m.contains_key(&key) {
            return None;
        }
        m.insert(key.clone(), value);
        drop(m);
        Some(Self {
            map,
            key: Some(key),
        })
    }

    /// Release the guard without removing the map entry. Used when ownership
    /// of the entry has transferred elsewhere (e.g. the spawned supervisor
    /// task that removes it when the run finishes).
    pub fn forget(mut self) {
        self.key.take();
    }
}

impl<K, V> Drop for MapKeyGuard<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Send + 'static,
{
    fn drop(&mut self) {
        if let Some(key) = self.key.take() {
            let map = self.map.clone();
            // Drop runs on any thread; spawn the removal so we don't block
            // the caller and so we don't need to be inside a runtime.
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn(async move {
                    map.lock().await.remove(&key);
                });
            }
        }
    }
}

/// Guard for the per-project-root concurrency map
/// (`DaemonContext::concurrency`).
pub type ConcurrencyGuard = MapKeyGuard<PathBuf, Uuid>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn guard_removes_on_drop() {
        let map: Arc<Mutex<HashMap<PathBuf, Uuid>>> = Arc::new(Mutex::new(HashMap::new()));
        let key = PathBuf::from("/repo");
        let run_id = Uuid::new_v4();
        {
            let g = ConcurrencyGuard::acquire(map.clone(), key.clone(), run_id).await;
            assert!(g.is_some());
            assert!(map.lock().await.contains_key(&key));
        }
        // Drop spawns a task; wait until the removal task completes.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(
            !map.lock().await.contains_key(&key),
            "guard did not clean up on drop"
        );
    }

    #[tokio::test]
    async fn acquire_returns_none_if_key_exists() {
        let map: Arc<Mutex<HashMap<PathBuf, Uuid>>> = Arc::new(Mutex::new(HashMap::new()));
        let key = PathBuf::from("/repo");
        let _first = ConcurrencyGuard::acquire(map.clone(), key.clone(), Uuid::new_v4())
            .await
            .unwrap();
        let second = ConcurrencyGuard::acquire(map.clone(), key, Uuid::new_v4()).await;
        assert!(
            second.is_none(),
            "second acquire should fail while first is alive"
        );
    }

    #[tokio::test]
    async fn forget_keeps_entry() {
        let map: Arc<Mutex<HashMap<PathBuf, Uuid>>> = Arc::new(Mutex::new(HashMap::new()));
        let key = PathBuf::from("/repo");
        let run_id = Uuid::new_v4();
        {
            let g = ConcurrencyGuard::acquire(map.clone(), key.clone(), run_id)
                .await
                .unwrap();
            g.forget();
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(
            map.lock().await.contains_key(&key),
            "forget() should leave the entry in place for external cleanup"
        );
    }

    #[tokio::test]
    async fn early_return_scenario_cleans_up() {
        // Simulates `do_start_run` failing after acquiring the guard.
        let map: Arc<Mutex<HashMap<PathBuf, Uuid>>> = Arc::new(Mutex::new(HashMap::new()));
        let key = PathBuf::from("/repo");

        async fn simulate(
            map: Arc<Mutex<HashMap<PathBuf, Uuid>>>,
            key: PathBuf,
            fail: bool,
        ) -> std::result::Result<(), &'static str> {
            let _g = ConcurrencyGuard::acquire(map, key, Uuid::new_v4())
                .await
                .ok_or("busy")?;
            if fail {
                return Err("preflight failed");
            }
            Ok(())
        }

        assert!(simulate(map.clone(), key.clone(), true).await.is_err());
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(
            !map.lock().await.contains_key(&key),
            "map should be empty after early-return"
        );
    }
}
