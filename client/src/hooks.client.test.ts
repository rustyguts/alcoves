import { describe, it, expect, vi } from 'vitest';
import { handleError } from './hooks.client';

describe('handleError', () => {
	it('logs the error and returns the message', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('kaboom');
		const result = handleError({
			error,
			message: 'Internal Error',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			event: {} as any,
			status: 500
		});
		expect(result).toEqual({ message: 'Internal Error' });
		expect(spy).toHaveBeenCalledWith('[client error]', error);
		spy.mockRestore();
	});
});
