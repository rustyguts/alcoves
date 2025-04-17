<script lang="ts">
  import dayjs from "dayjs";
  import timezone from "dayjs/plugin/timezone";
  import utc from "dayjs/plugin/utc";
  import Preview from "./Preview.svelte";

  // Initialize dayjs plugins
  dayjs.extend(utc);
  dayjs.extend(timezone);

  console.log("Assets Component");
  const { assets } = $props();
  // console.log("Assets:", assets);

  interface Asset {
    id: string;
    cTime: string;
    description?: string;
  }

  interface DayGroup {
    date: dayjs.Dayjs;
    formattedDate: string;
    assets: Asset[];
  }

  // Track selected assets
  let selectedAssets = $state<string[]>([]);

  // Track currently previewed asset
  let previewAsset = $state<Asset | null>(null);

  // Open preview modal
  function openPreview(asset: Asset) {
    previewAsset = asset;
  }

  // Close preview modal
  function closePreview() {
    previewAsset = null;
  }

  // Check if any assets are selected
  const hasSelectedAssets = $derived(selectedAssets.length > 0);

  // Select or deselect all assets
  function selectAll() {
    if (selectedAssets.length === assets.length) {
      // If all are selected, deselect all
      selectedAssets = [];
    } else {
      // Otherwise, select all
      selectedAssets = assets.map((asset) => asset.id);
    }
  }

  // Toggle selection for a single asset
  function toggleSelect(assetId: string) {
    if (selectedAssets.includes(assetId)) {
      selectedAssets = selectedAssets.filter((id) => id !== assetId);
    } else {
      selectedAssets = [...selectedAssets, assetId];
    }
  }

  // Delete selected assets
  function deleteSelected() {
    // Create and submit a form with the selected asset IDs
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "?/deleteAssets";

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "assetIds";
    input.value = selectedAssets.join(",");

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  // Group assets by day (flattened structure)
  const groupedByDay: DayGroup[] = [];

  for (const asset of assets) {
    const date = dayjs(asset.cTime).utc();
    const formattedDate = date.format("MMMM D, YYYY");

    // Look for an existing day group
    let dayGroup = groupedByDay.find(
      (group) => group.formattedDate === formattedDate
    );

    // If no group exists for this day, create one
    if (!dayGroup) {
      dayGroup = {
        date: date,
        formattedDate: formattedDate,
        assets: [],
      };
      groupedByDay.push(dayGroup);
    }

    // Add the asset to the day group
    dayGroup.assets.push(asset);
  }

  // Sort days chronologically, newest first
  groupedByDay.sort((a, b) => b.date.unix() - a.date.unix());
</script>

{#if assets && assets.length > 0}
  <div class="w-full">
    <!-- Action buttons -->
    <div class="flex items-center gap-2 mb-4">
      <button class="btn btn-sm" onclick={selectAll}>
        {selectedAssets.length === assets.length
          ? "Deselect All"
          : "Select All"}
      </button>

      {#if hasSelectedAssets}
        <button class="btn btn-sm btn-error" onclick={deleteSelected}>
          Delete {selectedAssets.length}
          {selectedAssets.length === 1 ? "Item" : "Items"}
        </button>
      {/if}
    </div>

    {#each groupedByDay as dayGroup}
      <div class="mb-8">
        <div class="bg-base-100 py-2 mb-4">
          <h2 class="text-xl font-bold">
            {dayGroup.formattedDate}
          </h2>
        </div>

        <div class="flex flex-wrap gap-2">
          {#each dayGroup.assets as asset}
            <div class="inline-block relative group">
              <!-- Checkbox overlay that shows on hover or when selected -->
              <div
                class="absolute top-2 right-2 z-10 transition-opacity duration-200
                          {selectedAssets.includes(asset.id)
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100'}"
              >
                <label class="cursor-pointer">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-primary"
                    checked={selectedAssets.includes(asset.id)}
                    onchange={() => toggleSelect(asset.id)}
                  />
                </label>
              </div>
              {#if selectedAssets.includes(asset.id)}
                <div
                  class="absolute inset-0 bg-opacity-25 rounded pointer-events-none"
                ></div>
              {/if}
              <div
                class="overflow-hidden rounded transition-all duration-200 group-hover:brightness-70 cursor-pointer"
                onclick={() => openPreview(asset)}
                onkeydown={(e) => e.key === "Enter" && openPreview(asset)}
                role="button"
                tabindex="0"
              >
                <img
                  class="h-40 w-auto object-cover"
                  alt={asset.id}
                  src={`/api/proxy/${asset.id}.jpg?width=400&height=400`}
                />
              </div>

              {#if asset.description}
                <p class="text-xs mt-0.5 text-opacity-70">
                  {asset.description}
                </p>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="alert alert-info">
    <span>No assets found.</span>
  </div>
{/if}

<!-- Preview modal component -->
<Preview asset={previewAsset} onClose={closePreview} />
