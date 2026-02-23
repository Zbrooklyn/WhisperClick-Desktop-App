# Professional Gaps — What Big Teams Do That We're Not

Identified: 2026-02-22

---

## Part 1: Gaps in Our Process

---

## Catching Bugs Before Users Do

### CI/CD Pipeline
No GitHub Actions or similar automation. Tests only run when someone remembers to run them, or when the release script forces it. Professional teams run tests on every push and every PR automatically. A failing test should block the merge, not get discovered after release.

### Code Coverage Tracking
We have 269 tests, but no way to know what percentage of code they actually exercise. Entire code paths could be untested. Tools like `coverage.py` or `pytest-cov` generate reports showing exactly which lines and branches are hit.

### Dependency Vulnerability Scanning
No Dependabot, Snyk, or similar. If `faster-whisper`, `PySide6`, or any other dependency ships a CVE, we won't know until something breaks. Automated scanning flags vulnerable packages and can auto-open PRs with the fix.

---

## User Trust and Distribution

### Code Signing
EXEs aren't signed. Windows SmartScreen warns users on launch, and some corporate environments block unsigned software entirely. This is the #1 reason users abandon installs. Requires purchasing a code signing certificate (or using Azure Trusted Signing).

### Auto-Update Mechanism
Users have to manually find and download new versions. Most desktop apps (Electron, Tauri, etc.) have built-in update checks. Could implement a simple version-check endpoint that the app polls on startup, with a "New version available" prompt.

### Crash Reporting
The structured logging we added writes to a local file, but we have no visibility into what's happening on user machines. Tools like Sentry (with opt-in consent) let teams see real crash data, stack traces, and frequency — without users needing to manually report bugs.

---

## Development Velocity

### Branch Protection / PR Workflow
Everything goes straight to `main`/`master` with no review gate. Teams use feature branches, pull requests, and at minimum one approval before merge. GitHub branch protection rules can enforce this.

### Semantic Versioning and Changelogs
Version is just a date stamp from the build script. No CHANGELOG, no way for users to know what changed between releases. Semantic versioning (MAJOR.MINOR.PATCH) communicates whether an update has breaking changes, new features, or just fixes.

### Issue Tracking
No structured backlog. The roadmap doc exists but there's no prioritized, trackable list of bugs vs features vs tech debt. GitHub Issues with labels (bug, feature, debt) and milestones would give structure to what gets worked on and when.

---

## Code Quality Enforcement

### Linting and Formatting
No pre-commit hooks enforcing style (flake8, black, isort). Every professional team has automated formatting so code looks the same regardless of who wrote it. Consistent style also helps AI agents replicate existing patterns correctly.

### Static Type Checking
No mypy or pyright. Python's optional typing catches entire classes of bugs before runtime — wrong argument types, missing return values, attribute access on None.

### Code Complexity Metrics
No way to flag when a function gets too long or too deeply nested. Tools like radon or flake8-cognitive-complexity can enforce maximum complexity per function.

---

## Testing Layers We're Missing

### E2E / UI Automation Testing
The test suite tests the backend API, but nothing clicks through the actual UI. Tools like Playwright or pyautogui can automate "launch app, click record, wait, verify text appears."

### Fuzz Testing
No testing with random or malformed inputs to find crashes we'd never think to test for. Tools like Hypothesis (for Python) generate thousands of edge-case inputs automatically.

### Cross-Environment Testing
Only tested on one machine. Different Windows versions, different DPI configs, different audio hardware, different GPU drivers — all potential failure points. VM-based test matrices catch these.

### Accessibility Testing
No screen reader support verification, no keyboard-only navigation audit, no color contrast checks (WCAG compliance).

---

## Security Beyond What We Did

### Secrets Management
API keys stored in plaintext JSON. Professional apps use the OS credential store (Windows Credential Manager via the `keyring` library).

### Static Application Security Testing (SAST)
No automated security scanning. Tools like Bandit scan Python code for common vulnerabilities (hardcoded passwords, unsafe deserialization, shell injection).

### Threat Modeling
No documented analysis of attack surfaces. What happens if someone tampers with the config file? What about the local HTTP server pywebview uses? Professional teams document threat models before shipping.

### Dependency License Compliance
No audit of whether all dependency licenses are compatible with the intended distribution model. Some libraries have copyleft licenses that impose obligations on the entire project.

---

## Documentation That's Missing

### User-Facing Help Docs
No knowledge base, FAQ, or in-app help. Users have no way to learn about features or troubleshoot issues without contacting the developer.

### Architecture Decision Records (ADRs)
No record of *why* decisions were made. Why pywebview over Electron? Why PySide6 for the pill? Future-you won't remember. ADRs capture the context, options considered, and rationale.

### Developer Onboarding Guide
If someone else wanted to contribute, there's no "here's how to set up the dev environment and run things." HANDOFF.md exists but isn't a step-by-step setup guide.

### API / Code Documentation
No generated docs from docstrings. Tools like Sphinx or pdoc can auto-generate browsable API docs from the codebase.

---

## Release Management

### Beta / Canary Channel
No way to ship to early adopters before a full release. Beta channels catch issues before they reach all users.

### Rollback Procedure
If a release is broken, there's no documented way to revert or push a hotfix. Professional teams have rollback playbooks.

### Release Checklist
The build script automates packaging, but there's no checklist for "test on clean machine, update download links, post announcement."

### Reproducible Builds
Can someone else clone the repo and produce a byte-identical build? Probably not. Reproducible builds increase trust and auditability.

---

## Legal / Compliance

### Privacy Policy
The app records audio and sends it to cloud APIs. There's no privacy policy explaining what data goes where, how long it's retained, or who has access.

### EULA / Terms of Service
No license agreement shown during install. Users don't know what they're agreeing to.

### Open-Source License File
No LICENSE file in the repo defining how others can use the code.

### Third-Party License Attribution
Bundling dozens of libraries without their license notices. Some licenses (MIT, BSD, Apache) require attribution in distributed software.

---

## User Support Infrastructure

### Bug Report Templates
No structured way for users to report issues. GitHub issue templates with system info, steps to reproduce, and expected vs actual behavior make reports actionable.

### Diagnostic Export
No "Export debug info" button that bundles logs, system info, and config (with keys redacted) for troubleshooting.

### In-App Feedback Mechanism
No way for users to report problems without leaving the app.

---

## Design Process

### UX Research
No user interviews or usability testing. Building based on assumptions about what users want.

### Design System
No documented color palette, typography, spacing rules. UI changes are ad-hoc.

### Wireframing Before Building
Features go straight to code without mockups or prototypes.

---

## Matters at Scale (Fine for Now)

### Feature Flags
No way to roll out features gradually or toggle them remotely. Useful when you have a large user base and want to test changes on a subset before full rollout.

### A/B Testing and Staged Rollouts
Related to feature flags — testing different UX approaches with real users to measure impact before committing.

### Internationalization (i18n)
UI is English-only. Translating the interface opens up the product to a much larger audience. Requires externalizing all user-facing strings.

### Performance Benchmarking
No benchmarks or regression detection. If a code change makes transcription 2x slower, there's no automated way to catch it. Benchmark suites with tracked metrics over time prevent silent performance degradation.

### Telemetry / Usage Analytics
No insight into how users actually use the app (with consent). Which features get used? Where do users get stuck? This data drives product decisions at scale.

### On-Call / Incident Response
No process for when something breaks in production. For a team shipping to many users, defined escalation paths and runbooks reduce downtime.

---
---

## Part 2: How AI Companies Build Software (Research)

What Anthropic, OpenAI, Google DeepMind, and others have learned about AI-driven software development — and what applies to our workflow.

---

## Anthropic: "Building Effective Agents" (December 2024)

Anthropic's foundational guide on designing agentic AI systems. Key architectural patterns:

- **Prompt Chaining** — Decompose tasks into sequential steps; each LLM call processes prior output. Best when tasks decompose cleanly into fixed subtasks.
- **Routing** — Classify inputs and direct them to specialized downstream processes.
- **Parallelization** — Either "sectioning" (independent subtasks in parallel) or "voting" (same task multiple times for confidence).
- **Orchestrator-Workers** — A central LLM dynamically breaks tasks into subtasks and delegates to worker agents. Best for unpredictable problem decomposition like multi-file code edits.
- **Evaluator-Optimizer** — One LLM generates; another evaluates and provides feedback in iterative loops.

**Critical advice:** Start simple. "Optimizing single LLM calls with retrieval and in-context examples is usually enough." Only add agent complexity when simpler solutions demonstrably fail.

**Tool design best practices:**
- Minimize formatting overhead; avoid requiring accurate line counts or complex escaping
- Match natural language patterns found in training data
- Apply "poka-yoke" (mistake-proofing) principles — e.g., changing file path arguments from relative to absolute eliminated errors
- Test tool interfaces extensively by running sample inputs and iterating on mistakes

**Framework advice:** Start with raw APIs. Frameworks "create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."

Source: https://www.anthropic.com/research/building-effective-agents

---

## Anthropic: "Effective Harnesses for Long-Running Agents" (November 2025)

Solves the problem of agents that must work across many context windows (sessions).

**Two-part architecture:**

1. **Initializer Agent** (first session): Sets up environment, creates a `claude-progress.txt` for logging, makes an initial git commit, generates a comprehensive feature list (200+ features in JSON, all initially marked "failing").

2. **Coding Agent** (all subsequent sessions): On startup, reads progress files and git logs, runs end-to-end tests, selects a single incomplete feature to implement. On closure, commits with descriptive messages and updates the progress file.

**Key patterns:**
- Work incrementally, one feature per session — prevents context exhaustion
- Use structured progress artifacts (JSON resists inappropriate modification better than markdown)
- Require explicit testing — without it, models skip verification and mark incomplete work as done
- Document ALL requirements upfront; don't let agents discover gaps incrementally

Source: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

---

## Anthropic: How AI Is Transforming Work Internally (August 2025)

Surveyed 132 engineers and researchers, conducted 53 in-depth interviews, studied internal Claude Code usage data.

**Key findings:**
- Engineers reported getting significantly more done
- Engineers became more "full-stack," able to succeed at tasks beyond their normal expertise
- Learning and iteration speed accelerated
- Engineers began tackling previously-neglected tasks (maintenance, refactoring, etc.)

Source: https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic

---

## Anthropic: 2026 Agentic Coding Trends Report (January 2026)

**Eight key trends:**
1. Engineering roles shifting from writing code to orchestrating agents
2. Multi-agent coordination becoming standard (57% of organizations deploy multi-step agent workflows)
3. Human-AI collaboration patterns maturing
4. Agentic coding expanding beyond engineering teams

**Key statistics:**
- Developers integrate AI into 60% of their work
- Engineers maintain active oversight on 80-100% of delegated tasks
- Engineers can "fully delegate" only 0-20% of tasks; the rest requires supervision
- TELUS built 13,000+ custom AI solutions, shipping code 30% faster, saving 500,000 hours across 57,000+ team members
- Rakuten pointed Claude Code at a 12.5-million-line codebase, and the agent worked autonomously for 7 hours achieving 99.9% numerical accuracy
- AI agents market projected to grow from $7.84B (2025) to $52.62B (2030) at 46.3% CAGR

Source: https://resources.anthropic.com/2026-agentic-coding-trends-report

---

## Anthropic: Claude Code Agent Teams (February 2026)

Multiple agent instances coordinate as a team — one lead orchestrates, teammates work independently, and they communicate via inter-agent messaging.

**Stress test:** 16 agents tasked with writing a Rust-based C compiler from scratch capable of compiling the Linux kernel. Over ~2,000 sessions and ~$20,000 in API costs, the team produced a 100,000-line compiler that can build Linux 6.9 on x86, ARM, and RISC-V.

**Best practices:**
- Include task-specific details in spawn prompts (teammates don't inherit the lead's history)
- Enable "delegate mode" to prevent the lead from grabbing tasks teammates should handle
- Pre-approve common file write/command execution permissions to reduce friction
- Monitor actively; steer early and often

Source: https://www.anthropic.com/engineering/building-c-compiler

---

## OpenAI: Codex and "Harness Engineering" (2025-2026)

OpenAI built a million-line codebase from scratch using Codex agents. The first commit to an empty repository landed in late August 2025, with the initial scaffold generated by Codex CLI.

**Critical lesson — Agent Drift:** Codex replicates patterns that already exist in the repository, even bad ones. Over time, this leads to "drift." The team initially spent 20% of their week (every Friday) manually cleaning up "AI slop."

**Solution — "Golden Principles" and "Garbage Collection":**
- **Golden Principles:** Opinionated, mechanical rules encoded directly in the repository (via `AGENTS.md` files) that keep the codebase consistent for future agent runs
- **Automated Garbage Collection:** Background Codex tasks that scan for deviations from golden principles and open targeted refactoring PRs on a regular cadence
- **Architectural Constraints as Multipliers:** Rigid layered architecture with enforced dependency rules, custom linters with remediation instructions in error messages, structural tests, and "taste invariants" (naming conventions, file size limits, logging format)

**Key insight:** In a human-first workflow, strict linting feels pedantic. With agents, these rules become *multipliers* — once encoded, they apply everywhere at once, preventing drift across a million-line codebase.

Source: https://openai.com/index/harness-engineering/

---

## ChatDev — Virtual AI Software Company (Tsinghua University, ACL 2024)

A research framework simulating a virtual software company using LLM-powered agents. Agents with roles (CEO, CTO, programmers, test engineers, art designers) follow a waterfall model through designing, coding, testing, and documenting.

**Key innovations:**
- **Chat Chain:** Divides each phase into smaller subtasks with multi-turn agent communication
- **Communicative Dehallucination:** Agents actively request more specific details before responding, reducing hallucinations
- **Inception Prompting:** Reinforces each agent's role and goals at the beginning of each dialogue to prevent role confusion

**Results:** Quality score improvement from 0.1523 (baseline) to 0.3953. Outperforms all baseline methods.

**Limitation:** High communication costs, often exceeding $10 per HumanEval task.

Source: https://arxiv.org/abs/2307.07924

---

## MetaGPT — AI Software Company Framework (ICLR 2024)

Multi-agent framework simulating Product Manager, Architect, Project Manager, and Engineer roles.

**Key difference from ChatDev:** Agents communicate through *structured outputs* (documents, diagrams, design specs) rather than free-form dialogue. This generates more coherent solutions.

**Assembly line paradigm:** Each agent produces structured artifacts that feed into the next stage, following standardized operating procedures encoded into prompt sequences.

Source: https://arxiv.org/abs/2308.00352

---

## Devin by Cognition Labs — "First AI Software Engineer" (March 2024)

**Benchmark performance on launch:** Resolved 13.86% of SWE-bench issues end-to-end (previous SOTA was 1.96%).

**18 months of deployment (2025 review):**
- 4x faster at problem solving vs. initial launch
- 67% of PRs now merged (vs. 34% at launch)
- Nubank migration: 12x efficiency improvement, 20x cost savings
- Security vulnerability remediation: 20x efficiency gain

**Independent audit (Answer.AI):** Tested 20 real tasks — 14 failures, 3 inconclusive, 3 successes (15% success rate). Highlights the gap between controlled benchmarks and real-world performance.

**Key finding:** "Senior-level at codebase understanding but junior at execution." Excels at tasks with clear requirements and verifiable outcomes that would take a junior engineer 4-8 hours.

Source: https://cognition.ai/blog/introducing-devin

---

## Google DeepMind: AlphaCode / AlphaEvolve

Different approach from "software company simulation" — focuses on optimization and algorithm discovery.

- **AlphaCode (2022):** Top 54% rank in programming competitions
- **AlphaCode 2 (2023):** Better than ~85% of competitors (powered by Gemini Pro)
- **AlphaEvolve (May 2025):** Evolutionary coding agent that evolves entire codebases. Achieved 23% speedup of a vital kernel in Gemini's own architecture
- **AlphaDev (June 2023):** Discovered sorting algorithms 70% faster for shorter sequences

Source: https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/

---

## SWE-bench and SWE-agent (Princeton University)

**SWE-bench:** The standard benchmark for evaluating AI coding agents on real-world software engineering tasks. Current top scores exceed 76% on SWE-bench Verified.

**SWE-agent key design innovation:** Rather than giving agents a full Linux shell, it provides a small set of simple actions for viewing, searching, and editing files, with guardrails. Interfaces tailored specifically for LLMs outperform human-designed interfaces.

**Key insight:** LLM agents are "a new category of end users with their own needs and abilities" that benefit from specially-built interfaces — not human-designed UIs.

Source: https://arxiv.org/abs/2405.15793

---
---

## Part 3: Aggregate Lessons — What Works and What Doesn't

---

### What Works

1. **Start simple, add complexity only when it demonstrably improves outcomes.** (Anthropic) Single LLM calls with retrieval often suffice. Don't reach for multi-agent architectures by default.

2. **Encode constraints mechanically, not conversationally.** (OpenAI) Linting rules, structural tests, architectural dependency enforcement, and "taste invariants" are multipliers for agent-generated code. Manual code review does not scale.

3. **Design agent-specific interfaces, not human interfaces.** (Princeton/SWE-agent) LLMs are a new category of user. Custom interfaces with guardrails and simplified action spaces outperform giving agents a raw shell.

4. **Use structured outputs over free-form dialogue for inter-agent communication.** (MetaGPT) Documents, diagrams, and JSON artifacts produce more coherent results than conversational message passing.

5. **Work incrementally, one feature per session.** (Anthropic) Prevents context exhaustion and reduces debugging burden. Leave code in a "mergeable" state at session end.

6. **Invest heavily in progress tracking and environmental scaffolding.** (Anthropic, OpenAI) Progress files, git history, comprehensive feature lists, and `AGENTS.md` / `CLAUDE.md` instruction files are essential for multi-session work.

7. **Automate cleanup proportionally to code generation throughput.** (OpenAI) "Garbage collection" agents scan for deviations from golden principles and open refactoring PRs on a regular cadence.

8. **Explicit testing requirements are mandatory.** (Anthropic) Without them, models skip verification and mark incomplete work as done.

9. **Clear, upfront requirements with verifiable outcomes produce the best results.** (Cognition/Devin) Agents excel at well-scoped, 4-8 hour tasks with clear acceptance criteria.

10. **Role-based inception prompting reduces role confusion.** (ChatDev) Reinforcing each agent's identity, goals, and constraints at the start of each interaction keeps conversations focused.

### What Doesn't Work

1. **Fully autonomous "set it and forget it" delegation.** Engineers can fully delegate only 0-20% of tasks; 80-100% require active oversight. (Anthropic 2026 Report)

2. **Relying on demos as evidence of production readiness.** The gap between a working demo and a reliable production system is where projects die. 95% of AI agent pilots fail. (Multiple sources)

3. **Giving agents raw, unstructured tools.** Broad action spaces without guardrails lead to compounding errors. (SWE-agent research)

4. **Ignoring agent drift.** Agents replicate patterns — even bad ones. Without mechanical enforcement, codebases degrade over time. (OpenAI Harness Engineering)

5. **Large multi-agent groups without cost controls.** Communication overhead is a real engineering constraint — costs can exceed $10 per simple task. (ChatDev, MetaGPT)

6. **Treating agent output as trusted.** Agents confidently fabricate details when they lack knowledge. All output must be verified. (Multiple sources)

7. **Skipping human-in-the-loop for high-stakes decisions.** The most successful implementations treat agents as "collaborative teammates with clear oversight, not replacements for human judgment." (McKinsey, Google Cloud)

8. **Using complex frameworks before understanding the fundamentals.** Frameworks create abstraction layers that obscure prompts and responses, making debugging harder. (Anthropic)

---

### Optimal Structure for AI-Driven Development

Based on aggregate findings across all research:

- **Repository-level instruction files** (`CLAUDE.md`, `AGENTS.md`) encoding project conventions, architectural rules, and golden principles
- **Mechanical enforcement** via linters, structural tests, and CI/CD gates
- **Incremental, session-based work** with progress tracking (progress files + git)
- **Specialized agent roles** (but not too many) with structured communication
- **Human oversight** at key decision points, especially architecture and design
- **Automated quality maintenance** (garbage collection agents, code review agents)
- **Agent-specific interfaces** rather than human-designed tools
- **Comprehensive upfront requirements** with explicit acceptance criteria and test requirements

---

## Sources

- [Building Effective AI Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)
- [Effective Harnesses for Long-Running Agents — Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [How AI Is Transforming Work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic)
- [2026 Agentic Coding Trends Report — Anthropic](https://resources.anthropic.com/2026-agentic-coding-trends-report)
- [Building a C Compiler with Agent Teams — Anthropic](https://www.anthropic.com/engineering/building-c-compiler)
- [Harness Engineering — OpenAI](https://openai.com/index/harness-engineering/)
- [Custom Instructions with AGENTS.md — OpenAI](https://developers.openai.com/codex/guides/agents-md/)
- [ChatDev Paper — arXiv](https://arxiv.org/abs/2307.07924)
- [MetaGPT Paper — arXiv](https://arxiv.org/abs/2308.00352)
- [Introducing Devin — Cognition Labs](https://cognition.ai/blog/introducing-devin)
- [AlphaEvolve — Google DeepMind](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)
- [SWE-agent Paper — arXiv](https://arxiv.org/abs/2405.15793)
- [SWE-bench Leaderboards](https://www.swebench.com/)
- [One Year of Agentic AI — McKinsey](https://www.mckinsey.com/capabilities/quantumblack/our-insights/one-year-of-agentic-ai-six-lessons-from-the-people-doing-the-work)
- [AI Agents and Trust — Google Cloud](https://cloud.google.com/transform/ai-grew-up-and-got-a-job-lessons-from-2025-on-agents-and-trust)
- [Evaluating AI Agents — Amazon](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/)
- [How Codex is Built — Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/how-codex-is-built)
