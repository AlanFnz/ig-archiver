import { describe, expect, it } from 'vitest';
import { isInstagramConversationUrl } from '../platform/chromePlatform';

describe('isInstagramConversationUrl', () => {
  it('accepts Instagram Direct conversation URLs', () => {
    expect(isInstagramConversationUrl('https://www.instagram.com/direct/t/123456789/')).toBe(true);
    expect(isInstagramConversationUrl('https://instagram.com/direct/t/abc_def')).toBe(true);
  });

  it('rejects Instagram pages that are not conversations', () => {
    expect(isInstagramConversationUrl('https://www.instagram.com/')).toBe(false);
    expect(isInstagramConversationUrl('https://www.instagram.com/direct/inbox/')).toBe(false);
    expect(isInstagramConversationUrl('https://www.instagram.com/reel/ABC123/')).toBe(false);
  });

  it('rejects lookalike hosts and invalid URLs', () => {
    expect(isInstagramConversationUrl('https://instagram.example/direct/t/123/')).toBe(false);
    expect(isInstagramConversationUrl('not a url')).toBe(false);
    expect(isInstagramConversationUrl()).toBe(false);
  });
});
