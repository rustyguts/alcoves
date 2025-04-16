<script lang="ts">
  console.log("Assets Component");
  const { assets } = $props();

  // Group assets by year, month, day
  const groupedAssets = assets.reduce((groups, asset) => {
    // Handle the createdAt format: "2025:02:24 17:58:53"
    const [year, month, day] = asset.createdAt.split(" ")[0].split(":");
    const monthKey = `${year}:${month}`;

    if (!groups[monthKey]) {
      groups[monthKey] = {
        monthName: getMonthName(Number.parseInt(month)),
        year: year,
        days: {},
      };
    }

    if (!groups[monthKey].days[day]) {
      groups[monthKey].days[day] = [];
    }

    groups[monthKey].days[day].push(asset);
    return groups;
  }, {});

  // Sort months chronologically (newest first)
  const sortedMonths = Object.keys(groupedAssets).sort().reverse();

  // Get month name from month number
  function getMonthName(monthNumber) {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return months[monthNumber - 1];
  }

  // Format day for display (add appropriate suffix)
  function formatDay(day) {
    const dayNum = Number.parseInt(day);
    if (dayNum > 3 && dayNum < 21) return `${dayNum}th`;
    switch (dayNum % 10) {
      case 1:
        return `${dayNum}st`;
      case 2:
        return `${dayNum}nd`;
      case 3:
        return `${dayNum}rd`;
      default:
        return `${dayNum}th`;
    }
  }
</script>

{#if assets && assets.length > 0}
  <div class="w-full">
    {#each sortedMonths as monthKey}
      {@const monthData = groupedAssets[monthKey]}
      <div class="mb-8">
        <h2 class="text-xl font-bold mb-4">
          {monthData.monthName}
          {monthData.year}
        </h2>

        {#each Object.keys(monthData.days).sort().reverse() as day}
          {@const dayAssets = monthData.days[day]}
          <div class="mb-6">
            <div class="bg-base-100 py-2">
              <h3 class="text-base font-semibold">
                {monthData.monthName}
                {formatDay(day)}
              </h3>
            </div>

            <div class="flex flex-wrap gap-1">
              {#each dayAssets as asset}
                <div class="inline-block">
                  <img
                    class="h-40 w-auto object-cover rounded"
                    alt={asset.id}
                    src={`/api/proxy/${asset.id}.jpg?width=400`}
                  />
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
    {/each}
  </div>
{:else}
  <div class="alert alert-info">
    <span>No assets found.</span>
  </div>
{/if}
