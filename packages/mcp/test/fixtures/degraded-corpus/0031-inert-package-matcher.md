---
schemaVersion: 0.1.0
id: "0031"
title: Record with an inert package matcher
status: accepted
date: 2026-03-02
deciders:
  - "@maintainer"
tags:
  - inert
affects:
  - type: path
    pattern: "src/**"
  - type: package
    pattern: "left-pad@^1"
---

# Inert package matcher

The package matcher is inert without a dependency snapshot.
