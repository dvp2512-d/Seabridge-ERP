import { describe, it, expect } from 'vitest';

describe('Test Framework', () => {
  it('vitest is working', () => {
    expect(1 + 1).toBe(2);
  });

  it('environment variables are set by setup', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
  });
});
