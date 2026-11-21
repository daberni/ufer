---
title: "Continue Ufer as an independent Node and React product"
adr:
  id: "001"
  status: accepted
  date: 2026-11-15
  authors:
    - Ufer maintainers
---

# Continue Ufer as an independent Node and React product

## Context

Sure provides substantially more existing finance functionality and a useful UI, but adopting it would require learning and maintaining Rails, changing its connection-credential model for our hosted journey, and carrying upstream integration work. Stack familiarity and product ownership are material maintenance constraints.

## Decision

Continue Ufer in Node.js/TypeScript and React. Use competitor workflows as references, while implementing Ufer's own finance behavior and supported user journey. The user explicitly selected this direction. No Sure fork or replacement React frontend for Sure is planned.

## Consequences

Ufer owns financial correctness, integrations, upgrades and operations. Focus on a coherent mainstream bank-sync experience, useful default reports and mobile use rather than recreating every competitor feature. Feature breadth and willingness to pay remain unproven.

## Compliance

Keep the feature comparison honest about implemented versus required behavior. Preserve existing data and keep all repository examples generic and English.

## Notes

[Architecture](../../architecture.md), [feature comparison](../../feature-comparison.md), [product direction](../../product-direction.md).
