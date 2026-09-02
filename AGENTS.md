# Agent & Skill Configuration

This document specifies the autonomous workflows and operational boundaries for Claude.

## Permissions & Capabilities

1. **Tool Autonomy:** Agents may directly invoke modules such as `context-mode` and `context7` to expand context or analyze code.
2. **Visual Design:** The `frontend-design` skill should be autonomously engaged when implementing UI components using Vue.js and TailwindCSS.
3. **Task-Specific Agent Roles:**
   - **Ingestion API Agent:** Handles Express.js routes, payload validation, and Redis rate-limiting.
   - **Worker / Queue Agent:** Manages RabbitMQ bindings, DLQ configurations, and HTTP delivery workers.
   - **Dashboard Agent:** Builds Vue.js components, Tailwind UI, and Socket.io client integration.

## Strict Boundaries

- No agent or skill may perform any version control (Git) operations.
- All agents must strictly adhere to the "Commenting Standards" specified in `CLAUDE.md` during code generation or refactoring.
