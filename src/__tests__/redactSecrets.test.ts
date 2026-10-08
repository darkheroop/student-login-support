import { redactSecrets, maskMobile } from '../security/redactSecrets';

describe('redactSecrets security utility', () => {
  it('redacts password, token, and otp keys deeply', () => {
    const payload = {
      user: {
        id: '123',
        password: 'SuperSecretPassword!',
        nested: {
          accessToken: 'jwt.token.here',
          otp: '123456',
          pin: '9988',
        },
      },
      status: 'active',
    };

    const redacted = redactSecrets(payload) as typeof payload;

    expect(redacted.user.id).toBe('123');
    expect(redacted.status).toBe('active');
    expect(redacted.user.password).toBe('[REDACTED]');
    expect(redacted.user.nested.accessToken).toBe('[REDACTED]');
    expect(redacted.user.nested.otp).toBe('[REDACTED]');
    expect(redacted.user.nested.pin).toBe('[REDACTED]');
  });

  it('redacts inside arrays of objects', () => {
    const list = [
      { id: 1, secret: 'shhh' },
      { id: 2, userPin: '4321' },
    ];

    const redacted = redactSecrets(list) as typeof list;

    expect(redacted[0].secret).toBe('[REDACTED]');
    expect(redacted[1].userPin).toBe('[REDACTED]');
  });

  it('preserves primitive values and non-sensitive keys', () => {
    expect(redactSecrets('plain text')).toBe('plain text');
    expect(redactSecrets(12345)).toBe(12345);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });
});

describe('maskMobile utility', () => {
  it('masks phone numbers, showing only the last 4 digits', () => {
    expect(maskMobile('9876543210')).toBe('******3210');
    expect(maskMobile('+91 98765 43210')).toBe('********3210');
    expect(maskMobile('1234')).toBe('1234');
  });
});
