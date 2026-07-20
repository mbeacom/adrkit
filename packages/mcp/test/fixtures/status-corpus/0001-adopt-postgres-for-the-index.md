---
schemaVersion: 0.1.0
id: "0001"
title: Adopt PostgreSQL for the index
status: accepted
date: 2026-01-01
deciders:
  - "@maintainer"
tags:
  - database
  - storage
scope: component
affects:
  - type: path
    pattern: "src/**"
relatesTo: []
supersedes: []
---

# Adopt PostgreSQL for the index

We will use Postgres as the durable index. The token pgvector appears only in
this body and nowhere in any title, id, or tag.
