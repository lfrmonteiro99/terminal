// Role / personality catalogue dispatcher.
//
// Roles and personalities are *catalogues*, not enums: the daemon seeds a set
// of built-ins on first start, and the operator can edit, extend or delete any
// of them. Every mutation emits a single `CatalogUpdated` snapshot, so the
// client never has to reconstruct state from a diff.
//
// Seeding is idempotent and non-destructive: a built-in is only written when
// its id is *absent* from the store, so operator edits survive restarts, and
// deleting a built-in restores it (self-healing) rather than losing it forever.

use crate::daemon_context::DaemonContext;
use chrono::Utc;
use std::sync::Arc;
use terminal_core::models::{Personality, Role};
use terminal_core::protocol::v1::{AppCommand, AppEvent};
use tokio::sync::mpsc;
use tracing::{info, warn};

pub struct CatalogDispatcher {
    ctx: Arc<DaemonContext>,
}

/// Built-in roles, seeded on first start. `id` is a stable slug so references
/// from agents survive; the text is the base mission every agent in the role
/// inherits.
const BUILTIN_ROLES: &[(&str, &str, &str)] = &[
    (
        "generic",
        "Generic",
        "You are a capable generalist. Do what the task asks and nothing more; \
         prefer the smallest change that fully solves it.",
    ),
    (
        "planner",
        "Planner",
        "You plan, you do not implement. Produce a concrete, ordered plan: the \
         files to touch, the approach for each, and the risks. Stop after the \
         plan — do not edit files.",
    ),
    (
        "implementer",
        "Implementer",
        "You implement. Make the change the task describes, keep it focused, and \
         make sure it builds and its tests pass before you finish.",
    ),
    (
        "verifier",
        "Verifier",
        "You verify, you do not implement. Check the work against the task's \
         criteria and report, with evidence (commands run and their output), \
         exactly what passes and what does not. Do not fix anything — report it.",
    ),
    (
        "reviewer",
        "Reviewer",
        "You review adversarially. Read the diff and hunt for defects: \
         correctness, edge cases, regressions, security, and anything the task \
         required but the change misses. Be specific and cite the code.",
    ),
    (
        "debugger",
        "Debugger",
        "You find root causes. Reproduce the failure, isolate the mechanism, and \
         prove it before changing code. State the cause explicitly, then fix it \
         and show the failing case now passing.",
    ),
    (
        "scribe",
        "Scribe",
        "You document. Write and update docs to match what the code actually \
         does — no aspirational claims, no invented behaviour.",
    ),
];

/// Built-in personalities: the *tone*, orthogonal to the role.
const BUILTIN_PERSONALITIES: &[(&str, &str, &str)] = &[
    (
        "terse",
        "Terse",
        "Answer in as few words as the task allows. No preamble, no recap, no \
         filler. Prefer bullets over prose.",
    ),
    (
        "thorough",
        "Thorough",
        "Explain your reasoning as you go. Cover edge cases, state assumptions \
         explicitly, and call out what you did not check.",
    ),
    (
        "pragmatic",
        "Pragmatic",
        "Optimise for shipping. Choose the simplest approach that works, flag \
         anything that is a genuine trade-off, and do not gold-plate.",
    ),
    (
        "socratic",
        "Socratic",
        "Surface the assumptions behind the request. When something is \
         ambiguous, say what you would need to know rather than guessing.",
    ),
    (
        "adversarial",
        "Adversarial",
        "Assume the work is wrong until proven otherwise. Actively look for the \
         case that breaks it and lead with the strongest objection.",
    ),
    (
        "mentor",
        "Mentor",
        "Teach as you work: explain the why behind a choice, briefly, so the \
         reader learns the reasoning and not just the result.",
    ),
];

impl CatalogDispatcher {
    pub fn new(ctx: Arc<DaemonContext>) -> Self {
        Self { ctx }
    }

    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        match cmd {
            AppCommand::ListCatalog => self.emit(reply_tx).await,
            AppCommand::SaveRole { role } => self.save_role(role, reply_tx).await,
            AppCommand::DeleteRole { id } => self.delete_role(&id, reply_tx).await,
            AppCommand::SavePersonality { personality } => {
                self.save_personality(personality, reply_tx).await
            }
            AppCommand::DeletePersonality { id } => self.delete_personality(&id, reply_tx).await,
            _ => {}
        }
    }

    /// Seed built-ins that are not already present, then load everything into
    /// memory. Called once at startup.
    pub async fn recover(&self) {
        let persisted_roles = self.ctx.persistence.list_roles().unwrap_or_else(|e| {
            warn!("recover_catalog: list_roles failed: {}", e);
            Vec::new()
        });
        let persisted_personalities =
            self.ctx.persistence.list_personalities().unwrap_or_else(|e| {
                warn!("recover_catalog: list_personalities failed: {}", e);
                Vec::new()
            });

        let now = Utc::now();
        let mut roles = self.ctx.roles.lock().await;
        for (id, name, instructions) in BUILTIN_ROLES {
            if persisted_roles.iter().any(|r| r.id == *id) {
                continue;
            }
            let role = Role {
                id: (*id).to_string(),
                name: (*name).to_string(),
                instructions: (*instructions).to_string(),
                builtin: true,
                created_at: now,
                updated_at: now,
            };
            if let Err(e) = self.ctx.persistence.save_role(&role) {
                warn!("seed role {} failed: {}", id, e);
                continue;
            }
            roles.insert(role.id.clone(), role);
        }
        for role in persisted_roles {
            roles.insert(role.id.clone(), role);
        }
        drop(roles);

        let mut personalities = self.ctx.personalities.lock().await;
        for (id, name, prompt) in BUILTIN_PERSONALITIES {
            if persisted_personalities.iter().any(|p| p.id == *id) {
                continue;
            }
            let personality = Personality {
                id: (*id).to_string(),
                name: (*name).to_string(),
                prompt: (*prompt).to_string(),
                builtin: true,
                created_at: now,
                updated_at: now,
            };
            if let Err(e) = self.ctx.persistence.save_personality(&personality) {
                warn!("seed personality {} failed: {}", id, e);
                continue;
            }
            personalities.insert(personality.id.clone(), personality);
        }
        for personality in persisted_personalities {
            personalities.insert(personality.id.clone(), personality);
        }
        drop(personalities);

        let (n_roles, n_personalities) = (
            self.ctx.roles.lock().await.len(),
            self.ctx.personalities.lock().await.len(),
        );
        info!(
            "Recovered catalogue: {} role(s), {} personality(ies)",
            n_roles, n_personalities
        );
    }

    /// Emit the catalogue snapshot. Sorting is stable (built-ins first, then by
    /// name) so the UI list does not jump around between updates.
    async fn emit(&self, reply_tx: mpsc::Sender<AppEvent>) {
        let mut roles: Vec<Role> = self.ctx.roles.lock().await.values().cloned().collect();
        roles.sort_by(|a, b| b.builtin.cmp(&a.builtin).then(a.name.cmp(&b.name)));
        let mut personalities: Vec<Personality> = self
            .ctx
            .personalities
            .lock()
            .await
            .values()
            .cloned()
            .collect();
        personalities.sort_by(|a, b| b.builtin.cmp(&a.builtin).then(a.name.cmp(&b.name)));
        let _ = reply_tx
            .send(AppEvent::CatalogUpdated {
                roles,
                personalities,
            })
            .await;
    }

    async fn save_role(&self, mut role: Role, reply_tx: mpsc::Sender<AppEvent>) {
        if role.name.trim().is_empty() {
            self.fail("ROLE_NAME_REQUIRED", "Role name cannot be empty", reply_tx)
                .await;
            return;
        }
        if role.id.trim().is_empty() {
            // New role: mint a UUID id. Built-ins arrive with a slug already.
            role.id = uuid::Uuid::new_v4().to_string();
            role.created_at = Utc::now();
        } else if let Some(existing) = self.ctx.roles.lock().await.get(&role.id) {
            // Preserve provenance and creation time across edits.
            role.builtin = existing.builtin;
            role.created_at = existing.created_at;
        }
        role.name = role.name.trim().to_string();
        role.updated_at = Utc::now();

        if let Err(e) = self.ctx.persistence.save_role(&role) {
            self.fail("CATALOG_PERSIST_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }
        self.ctx.roles.lock().await.insert(role.id.clone(), role);
        self.emit(reply_tx).await;
    }

    async fn delete_role(&self, id: &str, reply_tx: mpsc::Sender<AppEvent>) {
        if let Err(e) = self.ctx.persistence.delete_role(id) {
            self.fail("CATALOG_DELETE_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }
        self.ctx.roles.lock().await.remove(id);
        self.emit(reply_tx).await;
    }

    async fn save_personality(&self, mut personality: Personality, reply_tx: mpsc::Sender<AppEvent>) {
        if personality.name.trim().is_empty() {
            self.fail(
                "PERSONALITY_NAME_REQUIRED",
                "Personality name cannot be empty",
                reply_tx,
            )
            .await;
            return;
        }
        if personality.id.trim().is_empty() {
            personality.id = uuid::Uuid::new_v4().to_string();
            personality.created_at = Utc::now();
        } else if let Some(existing) = self.ctx.personalities.lock().await.get(&personality.id) {
            personality.builtin = existing.builtin;
            personality.created_at = existing.created_at;
        }
        personality.name = personality.name.trim().to_string();
        personality.updated_at = Utc::now();

        if let Err(e) = self.ctx.persistence.save_personality(&personality) {
            self.fail("CATALOG_PERSIST_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }
        self.ctx
            .personalities
            .lock()
            .await
            .insert(personality.id.clone(), personality);
        self.emit(reply_tx).await;
    }

    async fn delete_personality(&self, id: &str, reply_tx: mpsc::Sender<AppEvent>) {
        if let Err(e) = self.ctx.persistence.delete_personality(id) {
            self.fail("CATALOG_DELETE_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }
        self.ctx.personalities.lock().await.remove(id);
        self.emit(reply_tx).await;
    }

    async fn fail(&self, code: &str, message: &str, reply_tx: mpsc::Sender<AppEvent>) {
        let _ = reply_tx
            .send(AppEvent::Error {
                code: code.into(),
                message: message.into(),
            })
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_ids_are_unique_slugs() {
        let mut ids: Vec<&str> = BUILTIN_ROLES.iter().map(|(id, _, _)| *id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate builtin role id");

        let mut pids: Vec<&str> = BUILTIN_PERSONALITIES.iter().map(|(id, _, _)| *id).collect();
        let pcount = pids.len();
        pids.sort_unstable();
        pids.dedup();
        assert_eq!(pids.len(), pcount, "duplicate builtin personality id");

        // Ids reach the filesystem, so they must already be safe.
        for id in ids.iter().chain(pids.iter()) {
            assert!(
                id.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                "unsafe builtin id: {id}"
            );
        }
    }

    #[test]
    fn every_builtin_has_prompt_text() {
        for (id, name, instructions) in BUILTIN_ROLES {
            assert!(!name.trim().is_empty(), "role {id} has no name");
            assert!(!instructions.trim().is_empty(), "role {id} has no instructions");
        }
        for (id, name, prompt) in BUILTIN_PERSONALITIES {
            assert!(!name.trim().is_empty(), "personality {id} has no name");
            assert!(!prompt.trim().is_empty(), "personality {id} has no prompt");
        }
    }
}
