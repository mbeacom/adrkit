import { describe, expect, test } from 'bun:test';
import { FrontmatterError, parseFrontmatter } from '../src/parse/frontmatter.ts';

describe('parseFrontmatter', () => {
  test('parses block scalars, arrays, and nested maps', () => {
    const source = `---
title: >-
  Use a real YAML parser
items:
  - alpha
  - beta
nested:
  child:
    enabled: true
---

# Body
`;

    const parsed = parseFrontmatter(source);
    expect(parsed.data).toEqual({
      title: 'Use a real YAML parser',
      items: ['alpha', 'beta'],
      nested: { child: { enabled: true } },
    });
  });

  test('preserves body bytes after the closing fence', () => {
    const body = '\n# Title\n\nBody with trailing spaces   \n';
    const parsed = parseFrontmatter(`---\nid: "0001"\n---\n${body}`);
    expect(parsed.body).toBe(body);
  });

  test('throws a typed error when the leading fence is missing', () => {
    expect(() => parseFrontmatter('id: "0001"\n---\nbody')).toThrow(FrontmatterError);
    try {
      parseFrontmatter('id: "0001"\n---\nbody');
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterError);
      expect((error as FrontmatterError).code).toBe('missing-frontmatter');
    }
  });
});
