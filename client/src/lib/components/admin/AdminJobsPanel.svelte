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
	import { cn } from '$lib/utils';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';

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

	const statusFilterLabel = $derived(
		statusOptions.find((o) => o.value === statusFilter)?.label ?? 'All statuses'
	);
	const queueFilterLabel = $derived(
		queueOptions.find((o) => o.value === queueFilter)?.label ?? 'All queues'
	);

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

	// Soft/tonal chip tint per job state — all built from the semantic tokens
	// (no built-in Badge variant covers "warning"/"success", so those two are
	// hand-tinted the same way the vendored `destructive` variant is).
	const stateBadgeClass: Record<StateColor, string> = {
		info: 'bg-primary/10 text-primary',
		neutral: 'bg-muted text-muted-foreground',
		error: 'bg-destructive/10 text-destructive',
		warning: 'bg-warning/10 text-warning',
		success: 'bg-success/10 text-success'
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

	const NEUTRAL_TILE = 'text-muted-foreground bg-muted';
	const statTiles = $derived<StatTile[]>([
		{
			label: 'Active',
			value: totalActive,
			icon: ICONS.stateActive,
			iconClass: 'text-primary bg-primary/10'
		},
		{ label: 'Waiting', value: totalWaiting, icon: ICONS.stateWaiting, iconClass: NEUTRAL_TILE },
		{
			label: 'Failed',
			value: totalFailed,
			icon: ICONS.stateFailed,
			iconClass: totalFailed > 0 ? 'text-destructive bg-destructive/10' : NEUTRAL_TILE
		},
		{
			label: 'Delayed',
			value: totalDelayed,
			icon: ICONS.stateDelayed,
			iconClass: 'text-warning bg-warning/10'
		}
	]);
</script>

<div class="flex min-h-0 min-w-0 flex-col gap-6">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div>
			{#if embedded}
				<h2 class="text-xl font-bold">Background Jobs</h2>
			{:else}
				<h1 class="text-2xl font-bold">Background Jobs</h1>
			{/if}
			<p class="mt-0.5 text-sm text-muted-foreground">
				Real-time monitoring of background task queues.
			</p>
		</div>
		<Badge
			class={cn(
				'gap-1.5',
				connected ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
			)}
		>
			<AppIcon name={connected ? ICONS.live : ICONS.disconnected} class="size-4" />
			{connected ? 'Live' : 'Disconnected'}
		</Badge>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
		{#each statTiles as tile (tile.label)}
			<StatCard title={tile.label} value={tile.value} icon={tile.icon} iconClass={tile.iconClass} />
		{/each}
	</div>

	{#if queues.length}
		<div class="min-w-0">
			<AppPanel
				title="Queues"
				icon={ICONS.jobDefault}
				bodyClass="min-w-0 max-h-[24rem] overflow-y-auto"
			>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Queue</Table.Head>
							<Table.Head class="text-right">Active</Table.Head>
							<Table.Head class="text-right">Waiting</Table.Head>
							<Table.Head class="text-right">Delayed</Table.Head>
							<Table.Head class="text-right">Failed</Table.Head>
							<Table.Head class="text-right">Completed</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each queues as q (q.name)}
							<Table.Row
								class="cursor-pointer"
								onclick={() => (queueFilter = queueFilter === q.name ? 'all' : q.name)}
							>
								<Table.Cell>
									<div class="flex items-center gap-2">
										<AppIcon name={queueIcon(q.name)} class="size-4 text-primary" />
										<span class="font-medium capitalize">{formatQueueName(q.name)}</span>
										{#if queueFilter === q.name}
											<Badge class="bg-primary/10 text-primary">filtered</Badge>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell class="text-right font-medium text-primary">{q.active}</Table.Cell>
								<Table.Cell class="text-right font-medium">{q.waiting}</Table.Cell>
								<Table.Cell class="text-right font-medium text-warning">{q.delayed}</Table.Cell>
								<Table.Cell
									class={cn('text-right font-medium', q.failed > 0 && 'text-destructive')}
								>
									{q.failed}
								</Table.Cell>
								<Table.Cell class="text-right font-medium text-success">{q.completed}</Table.Cell>
								<Table.Cell class="text-right" onclick={(e) => e.stopPropagation()}>
									<Button
										variant="destructive"
										size="sm"
										disabled={actionQueueName === q.name}
										onclick={() => purgeQueue(q.name)}
									>
										{#if actionQueueName === q.name}
											<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
										{:else}
											<AppIcon name={ICONS.trash} class="size-4" />
										{/if}
										Purge
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</AppPanel>
		</div>
	{/if}

	<div class="min-w-0">
		<AppPanel title="Jobs" icon={ICONS.jobDefault} bodyClass="min-w-0 p-0">
			<!-- Custom header row (instead of AppPanel's `actions` slot, which is
			     pinned `shrink-0` next to the title with no wrap) so the queue/status
			     filters and the job-count badge wrap onto their own line instead of
			     hard-clipping past the viewport edge on mobile. -->
			<div class="flex min-w-0 flex-wrap items-center gap-2 border-b p-4">
				<Select.Root type="single" value={queueFilter} onValueChange={(v) => (queueFilter = v)}>
					<Select.Trigger class="w-36 sm:w-40" aria-label="Filter by queue">
						{queueFilterLabel}
					</Select.Trigger>
					<Select.Content>
						{#each queueOptions as opt (opt.value)}
							<Select.Item value={opt.value} label={opt.label} />
						{/each}
					</Select.Content>
				</Select.Root>
				<Select.Root type="single" value={statusFilter} onValueChange={(v) => (statusFilter = v)}>
					<Select.Trigger class="w-32 sm:w-36" aria-label="Filter by status">
						{statusFilterLabel}
					</Select.Trigger>
					<Select.Content>
						{#each statusOptions as opt (opt.value)}
							<Select.Item value={opt.value} label={opt.label} />
						{/each}
					</Select.Content>
				</Select.Root>
				<Badge variant="secondary" class="whitespace-nowrap">
					{filteredJobs.length}
					{filteredJobs.length === 1 ? 'job' : 'jobs'}
				</Badge>
			</div>

			<div class="max-h-[40rem] min-w-0 overflow-y-auto">
				{#if !connected && jobs.length === 0}
					<div class="flex flex-col gap-2 p-4">
						{#each Array(5) as _, i (i)}
							<Skeleton class="h-10 w-full" />
						{/each}
					</div>
				{:else if sortedJobs.length}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Status</Table.Head>
								<Table.Head>Type</Table.Head>
								<Table.Head>Queue</Table.Head>
								<Table.Head>Progress</Table.Head>
								<Table.Head>Attempts</Table.Head>
								<Table.Head>Created</Table.Head>
								<Table.Head class="text-right">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each sortedJobs as job (`${job.queueName}-${job.id}`)}
								<Table.Row class="cursor-pointer" onclick={() => toggleJobExpand(job.id)}>
									<Table.Cell>
										<Badge class={cn('gap-1.5', stateBadgeClass[stateColor(job.state)])}>
											<AppIcon name={stateIcon(job.state)} class="size-4" />
											{job.state}
										</Badge>
									</Table.Cell>
									<Table.Cell class="font-medium">{jobType(job)}</Table.Cell>
									<Table.Cell class="text-muted-foreground capitalize">
										{formatQueueName(job.queueName)}
									</Table.Cell>
									<Table.Cell class="min-w-[120px]">
										{#if job.state === 'active'}
											<div class="flex items-center gap-2">
												<Progress value={jobProgress(job)} max={100} class="h-2 w-20" />
												<span class="text-xs text-muted-foreground">{jobProgress(job)}%</span>
											</div>
										{:else if job.state === 'failed'}
											<span class="text-xs text-destructive">Failed</span>
										{:else}
											<span class="text-xs text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell>{job.attemptsMade}</Table.Cell>
									<Table.Cell class="text-xs text-muted-foreground">
										{formatTimestamp(job.timestamp)}
									</Table.Cell>
									<Table.Cell class="text-right" onclick={(e) => e.stopPropagation()}>
										{#if job.state === 'failed'}
											<div class="flex items-center justify-end gap-1">
												<Button
													variant="outline"
													size="icon-sm"
													aria-label="Retry"
													disabled={actionJobId === job.id}
													onclick={() => retryJob(job.queueName, job.id)}
												>
													<AppIcon
														name={actionJobId === job.id ? ICONS.loading : ICONS.retry}
														class={actionJobId === job.id ? 'size-4 animate-spin' : 'size-4'}
													/>
												</Button>
												<Button
													variant="destructive"
													size="icon-sm"
													aria-label="Remove"
													disabled={actionJobId === job.id}
													onclick={() => removeJob(job.queueName, job.id)}
												>
													<AppIcon
														name={actionJobId === job.id ? ICONS.loading : ICONS.trash}
														class={actionJobId === job.id ? 'size-4 animate-spin' : 'size-4'}
													/>
												</Button>
											</div>
										{/if}
									</Table.Cell>
								</Table.Row>
								{#if expandedJobId === job.id}
									<Table.Row class="bg-muted/40 hover:bg-muted/40">
										<Table.Cell colspan={7} class="whitespace-normal">
											<div class="flex flex-col gap-2 p-1 text-xs">
												{#if job.failedReason}
													<div class="flex gap-2">
														<span class="shrink-0 font-semibold text-destructive">Error:</span>
														<code class="break-all text-destructive/80">{job.failedReason}</code>
													</div>
												{/if}
												<div class="flex gap-2">
													<span class="shrink-0 font-semibold">Job ID:</span>
													<code class="text-muted-foreground">{job.id}</code>
												</div>
												{#if job.data && Object.keys(job.data).length}
													<div class="flex gap-2">
														<span class="shrink-0 font-semibold">Payload:</span>
														<code class="break-all text-muted-foreground">
															{JSON.stringify(job.data)}
														</code>
													</div>
												{/if}
												<div class="flex gap-4 text-muted-foreground">
													<span>Processed: {formatTimestamp(job.processedOn)}</span>
													<span>Finished: {formatTimestamp(job.finishedOn)}</span>
												</div>
											</div>
										</Table.Cell>
									</Table.Row>
								{/if}
							{/each}
						</Table.Body>
					</Table.Root>
				{:else}
					<EmptyState icon={ICONS.emptyQueue} title="No jobs matching current filters." />
				{/if}
			</div>
		</AppPanel>
	</div>

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
