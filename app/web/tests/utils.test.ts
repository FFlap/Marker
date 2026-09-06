import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '@/lib/utils';

describe('safeInternalPath', () => {
  it('accepts local application routes', () => {
    expect(safeInternalPath('/extension/connect?state=safe')).toBe('/extension/connect?state=safe');
  });

  it.each(['https://evil.test', '//evil.test', '/safe\nLocation:https://evil.test', undefined, '/login/', '/setup/', '/other/../login', '/LOGIN', '/%6cogin', '/%invalid'])(
    'rejects untrusted redirect %s',
    (value) => expect(safeInternalPath(value)).toBe('/'),
  );
});
