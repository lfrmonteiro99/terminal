// Agent domain dispatcher — the named-worker registry.
//
// An agent is a reusable Claude invocation: a mission (instructions), an
// optional model pin, and a default autonomy level. This dispatcher owns the
// CRUD surface; run execution reads the registry to resolve an agent's
// arguments (see `dispatcher::do_start_run` and `claude_runner::claude_args_for`).

use crate::daemon_context::DaemonContext;
use chrono::Utc;
use std::sync::Arc;
use terminal_core::models::{Agent, AgentRole, AgentSummary};
use terminal_core::protocol::v1::{AppCommand, AppEvent};
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

pub struct AgentDispatcher {
    ctx: Arc<DaemonContext>,
}

impl AgentDispatcher {
    pub fn new(ctx: Arc<DaemonContext>) -> Self {
        Self { ctx }
    }

    pub async fn handle(&self, cmd: AppCommand, reply_tx: mpsc::Sender<AppEvent>) {
        match cmd {
            AppCommand::ListAgents => self.list(reply_tx).await,
            AppCommand::CreateAgent {
                name,
                role,
                description,
                instructions,
                model,
                default_autonomy,
            } => {
                self.create(
                    name,
                    role,
                    description,
                    instructions,
                    model,
                    default_autonomy,
                    reply_tx,
                )
                .await
            }
            AppCommand::UpdateAgent {
                agent_id,
                name,
                role,
                description,
                instructions,
                model,
                default_autonomy,
            } => {
                self.update(
                    agent_id,
                    name,
                    role,
                    description,
                    instructions,
                    model,
                    default_autonomy,
                    reply_tx,
                )
                .await
            }
            AppCommand::DeleteAgent { agent_id } => self.delete(agent_id, reply_tx).await,
            _ => {}
        }
    }

    /// Load persisted agents into the in-memory registry. Called once at
    /// startup, mirroring `recover_workspaces`.
    pub async fn recover(&self) {
        let persisted = match self.ctx.persistence.list_agents() {
            Ok(v) => v,
            Err(e) => {
                warn!("recover_agents: list failed: {}", e);
                return;
            }
        };
        if persisted.is_empty() {
            return;
        }
        let mut agents = self.ctx.agents.lock().await;
        for agent in persisted {
            agents.insert(agent.id, agent);
        }
        info!("Recovered {} persisted agent(s)", agents.len());
    }

    async fn list(&self, reply_tx: mpsc::Sender<AppEvent>) {
        let agents = self.ctx.agents.lock().await;
        let mut summaries: Vec<AgentSummary> = agents.values().map(AgentSummary::from).collect();
        summaries.sort_by_key(|a| a.updated_at);
        let _ = reply_tx.send(AppEvent::AgentList { agents: summaries }).await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn create(
        &self,
        name: String,
        role: AgentRole,
        description: String,
        instructions: String,
        model: Option<String>,
        default_autonomy: terminal_core::models::AutonomyLevel,
        reply_tx: mpsc::Sender<AppEvent>,
    ) {
        // A name is the only hard requirement — an agent with an empty name is
        // indistinguishable in the UI and would collide in every list.
        let name = name.trim().to_string();
        if name.is_empty() {
            self.fail("AGENT_NAME_REQUIRED", "Agent name cannot be empty", reply_tx)
                .await;
            return;
        }

        let now = Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name,
            role,
            description,
            instructions,
            model: normalize_model(model),
            default_autonomy,
            created_at: now,
            updated_at: now,
        };

        if let Err(e) = self.ctx.persistence.save_agent(&agent) {
            self.fail("AGENT_PERSIST_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }

        let summary = AgentSummary::from(&agent);
        self.ctx.agents.lock().await.insert(agent.id, agent);
        info!("agent created: {} ({})", summary.name, summary.id);
        let _ = reply_tx.send(AppEvent::AgentCreated { agent: summary }).await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn update(
        &self,
        agent_id: Uuid,
        name: Option<String>,
        role: Option<AgentRole>,
        description: Option<String>,
        instructions: Option<String>,
        model: Option<String>,
        default_autonomy: Option<terminal_core::models::AutonomyLevel>,
        reply_tx: mpsc::Sender<AppEvent>,
    ) {
        let existing = self.ctx.agents.lock().await.get(&agent_id).cloned();
        let Some(mut agent) = existing else {
            self.fail(
                "AGENT_NOT_FOUND",
                &format!("No agent {agent_id}"),
                reply_tx,
            )
            .await;
            return;
        };

        if let Some(name) = name {
            let name = name.trim().to_string();
            if name.is_empty() {
                self.fail("AGENT_NAME_REQUIRED", "Agent name cannot be empty", reply_tx)
                    .await;
                return;
            }
            agent.name = name;
        }
        if let Some(role) = role {
            agent.role = role;
        }
        if let Some(description) = description {
            agent.description = description;
        }
        if let Some(instructions) = instructions {
            agent.instructions = instructions;
        }
        // `model` is Option<Option<..>> conceptually: an explicit `null` clears
        // the pin, but the wire cannot distinguish "absent" from "null" here,
        // so we treat a present-but-empty value as a clear and are explicit
        // about it in the docs. Absent (None) leaves the pin untouched.
        if let Some(model) = model {
            agent.model = normalize_model(Some(model));
        }
        if let Some(default_autonomy) = default_autonomy {
            agent.default_autonomy = default_autonomy;
        }
        agent.updated_at = Utc::now();

        if let Err(e) = self.ctx.persistence.save_agent(&agent) {
            self.fail("AGENT_PERSIST_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }

        let summary = AgentSummary::from(&agent);
        self.ctx.agents.lock().await.insert(agent.id, agent);
        let _ = reply_tx.send(AppEvent::AgentUpdated { agent: summary }).await;
    }

    async fn delete(&self, agent_id: Uuid, reply_tx: mpsc::Sender<AppEvent>) {
        if let Err(e) = self.ctx.persistence.delete_agent(agent_id) {
            self.fail("AGENT_DELETE_FAILED", &e.to_string(), reply_tx)
                .await;
            return;
        }
        let removed = self.ctx.agents.lock().await.remove(&agent_id).is_some();
        if !removed {
            // Not in memory and not on disk — surface it rather than a silent
            // "deleted" that changed nothing.
            self.fail(
                "AGENT_NOT_FOUND",
                &format!("No agent {agent_id}"),
                reply_tx,
            )
            .await;
            return;
        }
        info!("agent deleted: {agent_id}");
        let _ = reply_tx.send(AppEvent::AgentDeleted { agent_id }).await;
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

/// Treat an empty/whitespace model string as "clear the pin" rather than a
/// literal empty `--model`.
fn normalize_model(model: Option<String>) -> Option<String> {
    model.and_then(|m| {
        let m = m.trim().to_string();
        if m.is_empty() {
            None
        } else {
            Some(m)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Persistence;
    use terminal_core::config::DaemonConfig;
    use terminal_core::models::AutonomyLevel;
    use tempfile::TempDir;
    use tokio::sync::broadcast;

    fn make_dispatcher(tmp: &TempDir) -> AgentDispatcher {
        let cfg = DaemonConfig {
            data_dir: tmp.path().to_path_buf(),
            ..Default::default()
        };
        let (tx, _) = broadcast::channel::<String>(64);
        let persistence = Arc::new(Persistence::new(tmp.path().to_path_buf()).unwrap());
        let ctx = Arc::new(DaemonContext::new(cfg, tx, persistence));
        AgentDispatcher::new(ctx)
    }

    async fn recv(rx: &mut mpsc::Receiver<AppEvent>) -> AppEvent {
        rx.recv().await.expect("event")
    }

    #[tokio::test]
    async fn create_then_list_roundtrips() {
        let tmp = TempDir::new().unwrap();
        let d = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(8);

        d.handle(
            AppCommand::CreateAgent {
                name: "planner".into(),
                role: AgentRole::Planner,
                description: "drafts a plan".into(),
                instructions: "You produce a plan only.".into(),
                model: Some("claude-sonnet".into()),
                default_autonomy: AutonomyLevel::ReviewPlan,
            },
            tx.clone(),
        )
        .await;

        match recv(&mut rx).await {
            AppEvent::AgentCreated { agent } => {
                assert_eq!(agent.name, "planner");
                assert_eq!(agent.role, AgentRole::Planner);
                assert_eq!(agent.model.as_deref(), Some("claude-sonnet"));
                assert_eq!(agent.default_autonomy, AutonomyLevel::ReviewPlan);
            }
            other => panic!("expected AgentCreated, got {other:?}"),
        }

        d.handle(AppCommand::ListAgents, tx).await;
        match recv(&mut rx).await {
            AppEvent::AgentList { agents } => {
                assert_eq!(agents.len(), 1);
                assert_eq!(agents[0].name, "planner");
            }
            other => panic!("expected AgentList, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn empty_name_is_rejected() {
        let tmp = TempDir::new().unwrap();
        let d = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(8);

        d.handle(
            AppCommand::CreateAgent {
                name: "   ".into(),
                role: AgentRole::Generic,
                description: String::new(),
                instructions: String::new(),
                model: None,
                default_autonomy: AutonomyLevel::default(),
            },
            tx,
        )
        .await;

        match recv(&mut rx).await {
            AppEvent::Error { code, .. } => assert_eq!(code, "AGENT_NAME_REQUIRED"),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn update_changes_fields_and_persists() {
        let tmp = TempDir::new().unwrap();
        let d = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(8);

        d.handle(
            AppCommand::CreateAgent {
                name: "impl".into(),
                role: AgentRole::Implementer,
                description: String::new(),
                instructions: "old mission".into(),
                model: None,
                default_autonomy: AutonomyLevel::Autonomous,
            },
            tx.clone(),
        )
        .await;
        let id = match recv(&mut rx).await {
            AppEvent::AgentCreated { agent } => agent.id,
            other => panic!("expected AgentCreated, got {other:?}"),
        };

        d.handle(
            AppCommand::UpdateAgent {
                agent_id: id,
                name: None,
                role: Some(AgentRole::Verifier),
                description: None,
                instructions: Some("new mission".into()),
                model: Some("claude-opus".into()),
                default_autonomy: None,
            },
            tx,
        )
        .await;

        match recv(&mut rx).await {
            AppEvent::AgentUpdated { agent } => {
                assert_eq!(agent.role, AgentRole::Verifier);
                assert_eq!(agent.model.as_deref(), Some("claude-opus"));
                assert_eq!(agent.name, "impl", "name must be unchanged");
            }
            other => panic!("expected AgentUpdated, got {other:?}"),
        }

        // Re-read from disk: the update must have been persisted.
        let loaded = d.ctx.persistence.load_agent(id).unwrap().unwrap();
        assert_eq!(loaded.instructions, "new mission");
        assert_eq!(loaded.role, AgentRole::Verifier);
    }

    #[tokio::test]
    async fn update_unknown_agent_is_not_found() {
        let tmp = TempDir::new().unwrap();
        let d = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(8);

        d.handle(
            AppCommand::UpdateAgent {
                agent_id: Uuid::new_v4(),
                name: Some("x".into()),
                role: None,
                description: None,
                instructions: None,
                model: None,
                default_autonomy: None,
            },
            tx,
        )
        .await;

        match recv(&mut rx).await {
            AppEvent::Error { code, .. } => assert_eq!(code, "AGENT_NOT_FOUND"),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn recover_rehydrates_from_disk() {
        let tmp = TempDir::new().unwrap();
        let d = make_dispatcher(&tmp);
        let (tx, mut rx) = mpsc::channel(8);
        d.handle(
            AppCommand::CreateAgent {
                name: "persisted".into(),
                role: AgentRole::Generic,
                description: String::new(),
                instructions: String::new(),
                model: None,
                default_autonomy: AutonomyLevel::default(),
            },
            tx,
        )
        .await;
        recv(&mut rx).await;

        // Fresh context over the same data dir → recovered.
        let d2 = make_dispatcher(&tmp);
        d2.recover().await;
        let (tx2, mut rx2) = mpsc::channel(8);
        d2.handle(AppCommand::ListAgents, tx2).await;
        match recv(&mut rx2).await {
            AppEvent::AgentList { agents } => assert_eq!(agents.len(), 1),
            other => panic!("expected AgentList, got {other:?}"),
        }
    }
}
