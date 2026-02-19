FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for layer caching
COPY Cargo.toml Cargo.lock ./
COPY crates/terminal-core/Cargo.toml crates/terminal-core/Cargo.toml
COPY crates/terminal-daemon/Cargo.toml crates/terminal-daemon/Cargo.toml

# Create dummy src files so cargo can resolve the workspace
RUN mkdir -p crates/terminal-core/src crates/terminal-daemon/src \
    && echo "pub mod models; pub mod protocol; pub mod config;" > crates/terminal-core/src/lib.rs \
    && mkdir -p crates/terminal-core/src/protocol \
    && touch crates/terminal-core/src/models.rs \
    && touch crates/terminal-core/src/config.rs \
    && touch crates/terminal-core/src/protocol/mod.rs \
    && echo "fn main() {}" > crates/terminal-daemon/src/main.rs

# Pre-fetch and compile dependencies
RUN cargo build 2>/dev/null || true

# Now copy real source
COPY crates/ crates/

# Build
RUN cargo build

CMD ["cargo", "test"]
