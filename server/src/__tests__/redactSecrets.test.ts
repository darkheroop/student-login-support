import { redactSecrets, maskMobile } from '../security/redactSecrets';

describe('redactSecrets', () => {
  it('Redacts password field', () => {
    const input = { username: 'test', password: 'secretpassword' };
    const result = redactSecrets(input) as any;
    expect(result.password).toBe('[REDACTED]');
    expect(result.username).toBe('test');
  });

  it('Redacts nested token field', () => {
    const input = { data: { token: '12345', user: 'test' } };
    const result = redactSecrets(input) as any;
    expect(result.data.token).toBe('[REDACTED]');
    expect(result.data.user).toBe('test');
  });

  it('Redacts otp field', () => {
    const input = { OTP: '987654' };
    const result = redactSecrets(input) as any;
    expect(result.OTP).toBe('[REDACTED]');
  });

  it('Handles arrays', () => {
    const input = [{ password: '123' }, { name: 'john' }];
    const result = redactSecrets(input) as any;
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].name).toBe('john');
  });

  it('Does not mutate original object', () => {
    const input = { password: 'test' };
    redactSecrets(input);
    expect(input.password).toBe('test');
  });

  it('Handles null/undefined', () => {
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});

describe('maskMobile', () => {
  it('Masks correctly', () => {
    expect(maskMobile('1234567890')).toBe('******7890');
    expect(maskMobile('+1 (234) 567-8901')).toBe('*******8901');
    expect(maskMobile('123')).toBe('123');
  });
});
