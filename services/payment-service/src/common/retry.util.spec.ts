import { withRetry } from './retry.util';

describe('withRetry', () => {
  it('returns the result on the first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom again'))
      .mockResolvedValue('recovered');

    const onRetry = jest.fn();
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1, onRetry });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws the last error once retries are exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'always fails',
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
