FROM rust:1.88-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for layer caching
COPY Cargo.toml Cargo.lock ./
COPY crates/terminal-core/Cargo.toml crates/terminal-core/Cargo.toml
COPY crates/terminal-daemon/Cargo.toml crates/terminal-daemon/Cargo.toml
COPY crates/terminal-app/Cargo.toml crates/terminal-app/Cargo.toml

# Create dummy src files so cargo can resolve the workspace
RUN mkdir -p crates/terminal-core/src crates/terminal-daemon/src crates/terminal-app/src \
    && echo "pub mod models; pub mod protocol; pub mod config;" > crates/terminal-core/src/lib.rs \
    && mkdir -p crates/terminal-core/src/protocol \
    && touch crates/terminal-core/src/models.rs \
    && touch crates/terminal-core/src/config.rs \
    && touch crates/terminal-core/src/protocol/mod.rs \
    && echo "fn main() {}" > crates/terminal-daemon/src/main.rs \
    && echo "" > crates/terminal-daemon/src/lib.rs \
    && echo "fn main() {}" > crates/terminal-app/src/main.rs

# Pre-fetch and compile dependencies
RUN cargo build --release -p terminal-daemon 2>/dev/null || true

# Now copy real source
COPY crates/ crates/

# Build release binary
RUN cargo build --release -p terminal-daemon

# --- Runtime ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/terminal-daemon /usr/local/bin/terminal-daemon

ENV TERMINAL_HOST=0.0.0.0
ENV TERMINAL_PORT=3000
ENV TERMINAL_DATA_DIR=/data
ENV RUST_LOG=info

EXPOSE 3000

CMD ["terminal-daemon"]
