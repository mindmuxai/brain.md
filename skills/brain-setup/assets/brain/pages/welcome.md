---
id: welcome
title: "Example page: this is one piece of brain knowledge"
category: concept
status: active
tags: [example, getting-started]
created: "2026-06-22"
updated: "2026-06-22"
---

## compiled_truth

This is an **example page** that demonstrates the standard structure of `brain/pages/<id>.md`. Delete it whenever you like.

A page = two sections:

- **compiled_truth**: the current best understanding, rewritable as a whole. When you rewrite it, you must append a `kind: decision` entry to the timeline explaining why.
- **timeline**: an append-only chain of evidence; existing entries are never modified, and when a conclusion is overturned you append a `kind: reversal` entry.

To reference another page, use the `[[page-id]]` form — for example, this page itself is [[welcome]]. For the full read/write protocol, see the root `BRAIN.md` and the `brain-page` skill.

## timeline

- time: 2026-06-22T12:00
  kind: decision
  summary: Created the example page to demonstrate the two-section compiled_truth + timeline structure
  source: brain.md v0.1 skeleton initialization
  affects: [welcome]
