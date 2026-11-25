<script lang="ts">
  import type { PointsDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { session } from '#lib/session.svelte.js';

  let summary = $state<Record<string, PointsDto>>({});

  $effect(() => {
    for (const child of session.children) {
      api
        .get<PointsDto>(`/v1/members/${child.id}/points`)
        .then((p) => (summary = { ...summary, [child.id]: p }))
        .catch(() => {});
    }
  });
</script>

<main class="screen">
  <header class="screen-header"><h1>Dzieci</h1></header>

  <div class="stack">
    {#each session.children as child (child.id)}
      {@const p = summary[child.id]}
      <a class="card kid" href="/parent/kids/{child.id}">
        <Avatar name={child.name} url={child.avatarUrl} frameUrl={child.frameUrl} size={56} />
        <div class="grow">
          <h2>{child.name}</h2>
          {#if p}
            <div class="facts">
              <span><strong>{p.balance}</strong> pkt</span>
              <span class="flame"><Icon name="flame" size={16} /> <strong>{p.streak.current}</strong> dni</span>
              <span class="muted">rekord {p.streak.longest}</span>
            </div>
          {/if}
        </div>
        <Icon name="chevron" />
      </a>
    {:else}
      <div class="card empty">
        <p>Nie ma jeszcze dzieci.</p>
        <a class="btn primary" style="margin-top: 12px" href="/parent/settings">Dodaj dziecko</a>
      </div>
    {/each}
  </div>
</main>

<style>
  .kid {
    display: flex;
    align-items: center;
    gap: 14px;
    color: inherit;
    text-decoration: none;
  }
  .grow {
    flex: 1;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 4px;
    font-size: 0.9rem;
  }
  .flame {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: #c2410c;
  }
</style>
