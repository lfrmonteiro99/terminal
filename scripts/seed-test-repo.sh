#!/bin/bash
# Creates a rich test repo inside the daemon container for testing.
# Run: docker exec terminal-daemon-1 bash /app/scripts/seed-test-repo.sh

set -e
rm -rf /tmp/test-repo
mkdir -p /tmp/test-repo && cd /tmp/test-repo

git init
git config user.email "luis@terminal-engine.dev"
git config user.name "Luis Monteiro"

# === Commit 1: Initial project structure ===
mkdir -p src tests docs
cat > README.md << 'EOF'
# Terminal Engine Test Project

A sample project for testing Terminal Engine features.

## Getting Started
```bash
npm install
npm start
```
EOF

cat > src/main.ts << 'EOF'
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
EOF

cat > src/app.ts << 'EOF'
import { Router } from './router';

export interface AppConfig {
  port: number;
  debug: boolean;
  dbUrl: string;
}

export function createApp(config: AppConfig) {
  const router = new Router();

  router.get('/health', () => ({ status: 'ok' }));
  router.get('/api/users', () => [
    { id: 1, name: 'Alice', role: 'admin' },
    { id: 2, name: 'Bob', role: 'user' },
  ]);

  return {
    listen: (port: number, cb: () => void) => cb(),
    config,
    router,
  };
}
EOF

cat > src/config.ts << 'EOF'
export function loadConfig() {
  return {
    port: parseInt(process.env.PORT || '3000'),
    debug: process.env.DEBUG === 'true',
    dbUrl: process.env.DATABASE_URL || 'sqlite:///tmp/dev.db',
  };
}
EOF

cat > src/router.ts << 'EOF'
type Handler = () => unknown;

export class Router {
  private routes: Map<string, Handler> = new Map();

  get(path: string, handler: Handler) {
    this.routes.set(`GET ${path}`, handler);
  }

  post(path: string, handler: Handler) {
    this.routes.set(`POST ${path}`, handler);
  }

  resolve(method: string, path: string): unknown {
    const handler = this.routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Route not found: ${method} ${path}`);
    return handler();
  }
}
EOF

cat > tests/app.test.ts << 'EOF'
import { createApp } from '../src/app';

describe('App', () => {
  const app = createApp({ port: 3000, debug: false, dbUrl: 'sqlite://:memory:' });

  it('should return health status', () => {
    const result = app.router.resolve('GET', '/health');
    expect(result).toEqual({ status: 'ok' });
  });

  it('should return users list', () => {
    const result = app.router.resolve('GET', '/api/users');
    expect(result).toHaveLength(2);
  });
});
EOF

cat > docs/architecture.md << 'EOF'
# Architecture

## Overview
Simple layered architecture:
- **Router** — HTTP route matching
- **App** — Business logic and configuration
- **Config** — Environment-based configuration
EOF

cat > .gitignore << 'EOF'
node_modules/
dist/
*.log
.env
EOF

git add -A
git commit -m "Initial project structure with router, app, config, and tests"

# === Commit 2: Add authentication module ===
cat > src/auth.ts << 'EOF'
export interface User {
  id: number;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  email: string;
}

export function authenticate(token: string): User | null {
  // Simple token validation
  if (token === 'admin-token') {
    return { id: 1, name: 'Alice', role: 'admin', email: 'alice@example.com' };
  }
  if (token === 'user-token') {
    return { id: 2, name: 'Bob', role: 'user', email: 'bob@example.com' };
  }
  return null;
}

export function authorize(user: User, requiredRole: string): boolean {
  const hierarchy = ['viewer', 'user', 'admin'];
  return hierarchy.indexOf(user.role) >= hierarchy.indexOf(requiredRole);
}
EOF

cat > tests/auth.test.ts << 'EOF'
import { authenticate, authorize } from '../src/auth';

describe('Auth', () => {
  it('should authenticate valid admin token', () => {
    const user = authenticate('admin-token');
    expect(user?.role).toBe('admin');
  });

  it('should reject invalid token', () => {
    expect(authenticate('bad-token')).toBeNull();
  });

  it('should authorize admin for user role', () => {
    const admin = authenticate('admin-token')!;
    expect(authorize(admin, 'user')).toBe(true);
  });
});
EOF

git add -A
git commit -m "Add authentication and authorization module"

# === Commit 3: Add database layer ===
cat > src/database.ts << 'EOF'
export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export class Database {
  private connected = false;

  async connect(url: string): Promise<void> {
    console.log(`Connecting to ${url}...`);
    this.connected = true;
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.connected) throw new Error('Not connected');
    console.log(`Executing: ${sql}`, params);
    return { rows: [], rowCount: 0 };
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}
EOF

git add -A
git commit -m "Add database abstraction layer"

# === Commit 4: Create feature branch and make changes ===
git checkout -b feature/api-v2

cat > src/api-v2.ts << 'EOF'
import { Router } from './router';
import { authenticate } from './auth';
import { Database } from './database';

export function registerV2Routes(router: Router, db: Database) {
  router.get('/api/v2/users', () => {
    return db.query('SELECT * FROM users');
  });

  router.post('/api/v2/users', () => {
    return db.query('INSERT INTO users (name) VALUES (?)', ['New User']);
  });

  router.get('/api/v2/profile', () => {
    const user = authenticate('admin-token');
    return user;
  });
}
EOF

# Modify existing file to show diffs
sed -i 's/Simple token validation/JWT-based token validation (v2)/' src/auth.ts

git add -A
git commit -m "Add API v2 routes with database integration"

# === Back to master, make a different change (for merge scenario) ===
git checkout master

# Modify README with more content
cat >> README.md << 'EOF'

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /api/users | List all users |

## Configuration

Set these environment variables:
- `PORT` — Server port (default: 3000)
- `DEBUG` — Enable debug mode
- `DATABASE_URL` — Database connection string
EOF

git add -A
git commit -m "Expand README with API docs and configuration"

# === Now create some uncommitted changes (staged + unstaged) ===

# Staged changes
echo "export const VERSION = '0.2.0';" > src/version.ts
sed -i "s/port: parseInt/\/\/ TODO: validate port range\n    port: parseInt/" src/config.ts
git add src/version.ts src/config.ts

# Unstaged changes
echo "// TODO: add rate limiting" >> src/router.ts
echo "*.bak" >> .gitignore
cat > src/middleware.ts << 'EOF'
export function logger(req: unknown) {
  console.log(`[${new Date().toISOString()}] Request:`, req);
}

export function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
  };
}
EOF

echo ""
echo "=== Test repo created at /tmp/test-repo ==="
echo "Branch: $(git branch --show-current)"
echo "Commits: $(git log --oneline | wc -l)"
echo "Branches: $(git branch | wc -l)"
echo "Staged: $(git diff --cached --stat | tail -1)"
echo "Unstaged: $(git diff --stat | tail -1)"
echo ""
git log --oneline --all --graph
