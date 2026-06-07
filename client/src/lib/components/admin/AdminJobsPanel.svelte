<script module lang="ts">
	export interface QueueStat {
		name: string;
		waiting: number;
		active: number;
		completed: number;
		failed: number;
		delayed: number;
	}

	export interface JobEntry {
		id: string;
		queueName: string;
		name: string;
		data: Record<string, unknown>;
		progress: number | object;
		attemptsMade: number;
		failedReason: string | null;
		timestamp: number;
		processedOn: number | null;
		finishedOn: number | null;
		state: string;
	}

	interface StreamSnapshot {
		queues: QueueStat[];
		jobs: JobEntry[];
	}

	type StateColor = 'info' | 'neutral' | 'error' | 'warning' | 'success';
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { api, apiUrl } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';

	interface Props {
		embedded?: boolean;
	}

	let { embedded = false }: Props = $props();

	let queues = $state<QueueStat[]>([]);
	let jobs = $state<JobEntry[]>([]);
	let connected = $state(false);
	let statusFilter = $state('all');
	let queueFilter = $state('all');
	let actionJobId = $state<string | null>(null);
	let actionQueueName = $state<string | null>(null);
	let purgeTarget = $state<string | null>(null);
	let purgeModalOpen = $state(false);
	let expandedJobId = $state<string | null>(null);

	const statusOptions = [
		{ label: 'All statuses', value: 'all' },
		{ label: 'Active', value: 'active' },
		{ label: 'Waiting', value: 'waiting' },
		{ label: 'Failed', value: 'failed' },
		{ label: 'Delayed', value: 'delayed' }
	];

	const queueOptions = $derived([
		{ label: 'All queues', value: 'all' },
		...queues.map((q) => ({ label: formatQueueName(q.name), value: q.name }))
	]);

	const filteredJobs = $derived(
		jobs.filter((job) => {
			if (statusFilter !== 'all' && job.state !== statusFilter) return false;
			if (queueFilter !== 'all' && job.queueName !== queueFilter) return false;
			return true;
		})
	);

	const sortedJobs = $derived.by(() => {
		const order: Record<string, number> = { active: 0, waiting: 1, delayed: 2, failed: 3 };
		return [...filteredJobs].sort((a, b) => {
			const ao = order[a.state] ?? 4;
			const bo = order[b.state] ?? 4;
			if (ao !== bo) return ao - bo;
			return b.timestamp - a.timestamp;
		});
	});

	const totalActive = $derived(queues.reduce((s, q) => s + q.active, 0));
	const totalWaiting = $derived(queues.reduce((s, q) => s + q.waiting, 0));
	const totalFailed = $derived(queues.reduce((s, q) => s + q.failed, 0));
	const totalDelayed = $derived(queues.reduce((s, q) => s + q.delayed, 0));

	function formatQueueName(name: string): string {
		return name.replace(/^\{|\}$/g, '').replace(/-/g, ' ');
	}

	function queueIcon(name: string): string {
		if (name.includes('face')) return ICONS.jobFace;
		if (name.includes('video')) return ICONS.jobVideo;
		if (name.includes('thumbnail')) return ICONS.jobThumbnail;
		return ICONS.jobDefault;
	}

	function jobProgress(job: JobEntry): number {
		return typeof job.progress === 'number' ? job.progress : 0;
	}

	function stateColor(state: string): StateColor {
		const map: Record<string, StateColor> = {
			active: 'info',
			waiting: 'neutral',
			failed: 'error',
			delayed: 'warning',
			completed: 'success'
		};
		return map[state] ?? 'neutral';
	}

	const stateBadgeClass: Record<StateColor, string> = {
		info: 'preset-tonal-primary',
		neutral: 'preset-tonal-surface',
		error: 'preset-tonal-error',
		warning: 'preset-tonal-warning',
		success: 'preset-tonal-success'
	};

	function stateIcon(state: string): string {
		const map: Record<string, string> = {
			active: ICONS.stateActive,
			waiting: ICONS.stateWaiting,
			failed: ICONS.stateFailed,
			delayed: ICONS.stateDelayed,
			completed: ICONS.stateCompleted
		};
		return map[state] ?? ICONS.stateUnknown;
	}

	function formatTimestamp(ts: number | null): string {
		if (!ts) return '—';
		return new Date(ts).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function jobType(job: JobEntry): string {
		return job.name || formatQueueName(job.queueName);
	}

	function toggleJobExpand(jobId: string) {
		expandedJobId = expandedJobId === jobId ? null : jobId;
	}

	let eventSource: EventSource | null = null;

	function connectSSE() {
		eventSource = new EventSource(apiUrl('/api/admin/jobs/stream'), {
			withCredentials: true
		});
		eventSource.onopen = () => {
			connected = true;
		};
		eventSource.onmessage = (event) => {
			try {
				const snapshot: StreamSnapshot = JSON.parse(event.data);
				if (snapshot.queues) queues = snapshot.queues;
				if (snapshot.jobs) jobs = snapshot.jobs;
				connected = true;
			} catch {
				// heartbeat
			}
		};
		eventSource.onerror = () => {
			connected = false;
		};
	}

	async function retryJob(queueName: string, jobId: string) {
		actionJobId = jobId;
		try {
			await api.admin.controlJob(queueName, jobId, { action: 'retry' });
			toast.add({ title: 'Job retried', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to retry job', color: 'error' });
		} finally {
			actionJobId = null;
		}
	}

	async function removeJob(queueName: string, jobId: string) {
		actionJobId = jobId;
		try {
			await api.admin.controlJob(queueName, jobId, { action: 'remove' });
			toast.add({ title: 'Job removed', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to remove job', color: 'error' });
		} finally {
			actionJobId = null;
		}
	}

	function purgeQueue(queueName: string) {
		purgeTarget = queueName;
		purgeModalOpen = true;
	}

	async function confirmPurgeQueue() {
		const queueName = purgeTarget;
		if (!queueName) return;
		const target = formatQueueName(queueName);

		actionQueueName = queueName;
		try {
			const result = await api.admin.purgeQueue(queueName);
			toast.add({ title: `Purged ${result.total} jobs from ${target}`, color: 'success' });
			purgeModalOpen = false;
			purgeTarget = null;
		} catch {
			toast.add({ title: 'Failed to purge queue', color: 'error' });
		} finally {
			actionQueueName = null;
		}
	}

	onMount(() => connectSSE());
	onDestroy(() => {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	});

	interface StatTile {
		label: string;
		value: number;
		icon: string;
		iconClass: string;
	}

	const NEUTRAL_TILE = 'text-surface-500 bg-surface-500/10';
	const statTiles = $derived<StatTile[]>([
		{
			label: 'Active',
			value: totalActive,
			icon: ICONS.stateActive,
			iconClass: 'text-primary-500 bg-primary-500/10'
		},
		{ label: 'Waiting', value: totalWaiting, icon: ICONS.stateWaiting, iconClass: NEUTRAL_TILE },
		{
			label: 'Failed',
			value: totalFailed,
			icon: ICONS.stateFailed,
			iconClass: totalFailed > 0 ? 'text-error-500 bg-error-500/10' : NEUTRAL_TILE
		},
		{
			label: 'Delayed',
			value: totalDelayed,
			icon: ICONS.stateDelayed,
			iconClass: 'text-warning-500 bg-warning-500/10'
		}
	]);
</script>

<div class="flex min-h-0 flex-col gap-6">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div>
			{#if embedded}
				<h2 class="text-xl font-bold">Background Jobs</h2>
			{:else}
				<h1 class="text-2xl font-bold">Background Jobs</h1>
			{/if}
			<p class="mt-0.5 text-sm text-surface-500">Real-time monitoring of background task queues.</p>
		</div>
		<span class={['badge gap-1.5', connected ? 'preset-tonal-success' : 'preset-tonal-error']}>
			<AppIcon name={connected ? ICONS.live : ICONS.disconnected} class="size-4" />
			{connected ? 'Live' : 'Disconnected'}
		</span>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		{#each statTiles as tile (tile.label)}
			<StatCard title={tile.label} value={tile.value} icon={tile.icon} iconClass={tile.iconClass} />
		{/each}
	</div>

	{#if queues.length}
		<AppPanel title="Queues" icon={ICONS.jobDefault} flush bodyClass="max-h-[24rem] overflow-auto">
			<table class="w-full text-sm">
				<thead class="bg-surface-200-800">
					<tr class="text-left">
						<th class="px-4 py-3 font-medium">Queue</th>
						<th class="px-4 py-3 text-right font-medium">Active</th>
						<th class="px-4 py-3 text-right font-medium">Waiting</th>
						<th class="px-4 py-3 text-right font-medium">Delayed</th>
						<th class="px-4 py-3 text-right font-medium">Failed</th>
						<th class="px-4 py-3 text-right font-medium">Completed</th>
						<th class="px-4 py-3 text-right font-medium">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-surface-200-800">
					{#each queues as q (q.name)}
						<tr
							class="cursor-pointer hover:bg-surface-200-800/60"
							onclick={() => (queueFilter = queueFilter === q.name ? 'all' : q.name)}
						>
							<td class="px-4 py-3">
								<div class="flex items-center gap-2">
									<AppIcon name={queueIcon(q.name)} class="size-4 text-primary-500" />
									<span class="font-medium capitalize">{formatQueueName(q.name)}</span>
									{#if queueFilter === q.name}
										<span class="badge preset-tonal-primary text-xs">filtered</span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-3 text-right font-medium text-primary-500">{q.active}</td>
							<td class="px-4 py-3 text-right font-medium">{q.waiting}</td>
							<td class="px-4 py-3 text-right font-medium text-warning-500">{q.delayed}</td>
							<td
								class={['px-4 py-3 text-right font-medium', q.failed > 0 ? 'text-error-500' : '']}
							>
								{q.failed}
							</td>
							<td class="px-4 py-3 text-right font-medium text-success-500">{q.completed}</td>
							<td class="px-4 py-3 text-right" onclick={(e) => e.stopPropagation()}>
								<button
									type="button"
									class="btn gap-1.5 preset-tonal-error btn-sm"
									disabled={actionQueueName === q.name}
									onclick={() => purgeQueue(q.name)}
								>
									{#if actionQueueName === q.name}
										<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
									{:else}
										<AppIcon name={ICONS.trash} class="size-4" />
									{/if}
									Purge
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</AppPanel>
	{/if}

	<AppPanel title="Jobs" icon={ICONS.jobDefault} flush>
		{#snippet actions()}
			<select class="select w-36 sm:w-40" aria-label="Filter by queue" bind:value={queueFilter}>
				{#each queueOptions as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<select class="select w-32 sm:w-36" aria-label="Filter by status" bind:value={statusFilter}>
				{#each statusOptions as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<span class="badge preset-tonal-surface whitespace-nowrap">
				{filteredJobs.length}
				{filteredJobs.length === 1 ? 'job' : 'jobs'}
			</span>
		{/snippet}

		<div class="max-h-[40rem] overflow-auto">
			{#if !connected && jobs.length === 0}
				<div class="flex justify-center py-16">
					<AppIcon name={ICONS.loading} class="size-6 animate-spin text-surface-500" />
				</div>
			{:else if sortedJobs.length}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="bg-surface-200-800">
							<tr class="text-left">
								<th class="px-4 py-3 font-medium">Status</th>
								<th class="px-4 py-3 font-medium">Type</th>
								<th class="px-4 py-3 font-medium">Queue</th>
								<th class="px-4 py-3 font-medium">Progress</th>
								<th class="px-4 py-3 font-medium">Attempts</th>
								<th class="px-4 py-3 font-medium">Created</th>
								<th class="px-4 py-3 text-right font-medium">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-surface-200-800">
							{#each sortedJobs as job (`${job.queueName}-${job.id}`)}
								<tr
									class="cursor-pointer hover:bg-surface-200-800/60"
									onclick={() => toggleJobExpand(job.id)}
								>
									<td class="px-4 py-3">
										<span class={['badge gap-1.5', stateBadgeClass[stateColor(job.state)]]}>
											<AppIcon name={stateIcon(job.state)} class="size-4" />
											{job.state}
										</span>
									</td>
									<td class="px-4 py-3 font-medium">{jobType(job)}</td>
									<td class="px-4 py-3 text-surface-500 capitalize">
										{formatQueueName(job.queueName)}
									</td>
									<td class="min-w-[120px] px-4 py-3">
										{#if job.state === 'active'}
											<div class="flex items-center gap-2">
												<progress class="progress h-2 w-20" value={jobProgress(job)} max="100"
												></progress>
												<span class="text-xs text-surface-500">{jobProgress(job)}%</span>
											</div>
										{:else if job.state === 'failed'}
											<span class="text-xs text-error-500">Failed</span>
										{:else}
											<span class="text-xs text-surface-500">—</span>
										{/if}
									</td>
									<td class="px-4 py-3">{job.attemptsMade}</td>
									<td class="px-4 py-3 text-xs whitespace-nowrap text-surface-500">
										{formatTimestamp(job.timestamp)}
									</td>
									<td class="px-4 py-3 text-right" onclick={(e) => e.stopPropagation()}>
										{#if job.state === 'failed'}
											<div class="flex items-center justify-end gap-1">
												<button
													type="button"
													class="btn-icon btn-icon-sm preset-tonal-surface"
													title="Retry"
													aria-label="Retry"
													disabled={actionJobId === job.id}
													onclick={() => retryJob(job.queueName, job.id)}
												>
													<AppIcon
														name={actionJobId === job.id ? ICONS.loading : ICONS.retry}
														class={actionJobId === job.id ? 'size-4 animate-spin' : 'size-4'}
													/>
												</button>
												<button
													type="button"
													class="btn-icon btn-icon-sm preset-tonal-error"
													title="Remove"
													aria-label="Remove"
													disabled={actionJobId === job.id}
													onclick={() => removeJob(job.queueName, job.id)}
												>
													<AppIcon
														name={actionJobId === job.id ? ICONS.loading : ICONS.trash}
														class={actionJobId === job.id ? 'size-4 animate-spin' : 'size-4'}
													/>
												</button>
											</div>
										{/if}
									</td>
								</tr>
								{#if expandedJobId === job.id}
									<tr class="bg-surface-200-800/60">
										<td colspan="7">
											<div class="space-y-2 p-3 text-xs">
												{#if job.failedReason}
													<div class="flex gap-2">
														<span class="shrink-0 font-semibold text-error-500">Error:</span>
														<code class="break-all text-error-500/80">{job.failedReason}</code>
													</div>
												{/if}
												<div class="flex gap-2">
													<span class="shrink-0 font-semibold">Job ID:</span>
													<code class="text-surface-500">{job.id}</code>
												</div>
												{#if job.data && Object.keys(job.data).length}
													<div class="flex gap-2">
														<span class="shrink-0 font-semibold">Payload:</span>
														<code class="break-all text-surface-500">
															{JSON.stringify(job.data)}
														</code>
													</div>
												{/if}
												<div class="flex gap-4 text-surface-500">
													<span>Processed: {formatTimestamp(job.processedOn)}</span>
													<span>Finished: {formatTimestamp(job.finishedOn)}</span>
												</div>
											</div>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center gap-2 py-16">
					<AppIcon name={ICONS.emptyQueue} class="size-8 text-surface-500" />
					<p class="text-sm text-surface-500">No jobs matching current filters.</p>
				</div>
			{/if}
		</div>
	</AppPanel>

	<ConfirmModal
		bind:open={purgeModalOpen}
		title="Purge queue?"
		message={purgeTarget
			? `Purge jobs in queue "${formatQueueName(purgeTarget)}"? This removes waiting, delayed, failed, and completed jobs.`
			: ''}
		confirmLabel="Purge"
		confirmClass="error"
		confirmIcon={ICONS.trash}
		pending={actionQueueName !== null}
		onconfirm={confirmPurgeQueue}
	/>
</div>
