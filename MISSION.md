# Mission

The product is named **gitjig**.

## M1. Purpose

Enable developers and agents to carry software changes from intent to completion with sound engineering discipline and a trustworthy history.

Provide a coherent workflow through three independently useful levels: agent-level support for agent-driven work, local-level support for developer work, and repo-level support for repository governance. Their combination must preserve a usable end-to-end path rather than accumulate disconnected mechanisms.

## M2. Success

- Work has a clear entry and a coherent path through completion, interruption, and resumption.
- Changes fulfill agreed intent, receive meaningful verification and independent review, and leave evidence sufficient to explain their acceptance.
- Developers and repository administrators can use local and repo capabilities without adopting agent-specific procedures.
- Users can delegate sustained agent-driven development through merge. Contractual procedure completion establishes the agent's scoped representative standing; actual owner permissions and explicit delegation bound the actions it may then perform.
- Repository administrators can start with recommended rules and easily customize, apply, and inspect their repository's configuration. Developers can understand the rules that actually apply.
- Following the workflow costs little enough to support frequent development and verification.

## M3. Boundaries

These documents define this product, not a universal process constitution for every adopting repository. A local check or repository configuration operation is not a claim that an entire change has completed the agent workflow.

This product supports the adopting project's purpose; it does not choose that purpose or silently change its requirements. It does not require one universal repository policy, impose agent-specific rituals on human work, or promise that review and tests establish absolute correctness.

## M4. Document responsibilities

This document owns purpose, success, and scope. [Principles](PRINCIPLES.md) owns enduring constraints; [Design](DESIGN.md) owns the integrated structure and its rationale; [Contracts](CONTRACTS.md) owns observable behavior and acceptance conditions. Each decision has one authoritative home. Lower-level documents refine rather than silently amend higher-level decisions.

A lower-level contradiction is a specification defect, not permission to bypass a current contract. Resolve it in the document that owns the decision and update affected dependents. Check consistency downward and sufficiency upward: satisfying individual contracts must also yield the integrated workflow and intended success.
