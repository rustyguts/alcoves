import { describe, it, expect, beforeEach } from 'vitest';
import { portal } from './portal';

// Needs a real DOM → browser project (named .svelte.test.ts to route there).
beforeEach(() => {
	document.body.innerHTML = '';
});

describe('portal action', () => {
	it('moves the node into the target container', () => {
		const target = document.createElement('div');
		target.id = 'dest';
		document.body.appendChild(target);

		const node = document.createElement('span');
		document.body.appendChild(node);

		const ret = portal(node, '#dest');
		expect(node.parentElement).toBe(target);

		ret?.destroy?.();
		expect(node.parentElement).toBeNull();
	});

	it('leaves the node in place when the target is missing', () => {
		const node = document.createElement('span');
		document.body.appendChild(node);
		portal(node, '#missing');
		expect(node.parentElement).toBe(document.body);
	});

	it('re-homes the node on update', () => {
		const a = document.createElement('div');
		a.id = 'a';
		const b = document.createElement('div');
		b.id = 'b';
		document.body.append(a, b);

		const node = document.createElement('span');
		const ret = portal(node, '#a');
		expect(node.parentElement).toBe(a);
		ret?.update?.('#b');
		expect(node.parentElement).toBe(b);
	});
});
