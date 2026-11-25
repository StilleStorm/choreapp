<script lang="ts">
  import type { PointsDto } from '@choreapp/shared';
  import { api } from '#lib/api.js';
  import Icon from '#lib/components/Icon.svelte';
  import { dateTime, days, plural } from '#lib/format.js';
  import { errorMessage } from '#lib/messages.js';
  import { session } from '#lib/session.svelte.js';

  let data = $state<PointsDto | null>(null);
  let error = $state('');

  $effect(() => {
    api
      .get<PointsDto>('/v1/members/me/points')
      .then((d) => (data = d))
      .catch((e) => (error = errorMessage(e)));
  });

  const progress = $derived.by(() => {
    if (!data) return 0;
    const { threshold, daysLeft } = data.streak.nextPack;
    const prev = threshold === 7 ? 0 : threshold === 14 ? 7 : threshold - 30;
    return Math.min(1, (threshold - daysLeft - prev) / (threshold - prev));
  });
</script>

<main class="screen">
  <header class="screen-header"><h1>Punkty</h1></header>
  {#if error}<div class="error-box">{error}</div>{/if}

  {#if data}
    <section class="balance card">
      <span class="label">Masz</span>
      <span class="value">{data.balance}</span>
      <span class="label">{plural(data.balance, 'punkt', 'punkty', 'punktów')}</span>
      <a class="btn primary" href="/child/shop"><Icon name="shop" size={20} /> Do sklepu</a>
    </section>

    <section class="streaks">
      <div class="card stat">
        <span class="flame" class:lit={data.streak.current > 0}><Icon name="flame" size={30} /></span>
        <span class="num">{data.streak.current}</span>
        <span class="muted small">{data.streak.current === 1 ? 'dzień' : 'dni'} z rzędu</span>
      </div>
      <div class="card stat">
        <span class="trophy"><Icon name="trophy" size={30} /></span>
        <span class="num">{data.streak.longest}</span>
        <span class="muted small">najdłuższa seria</span>
      </div>
    </section>

    <section class="card next">
      <div class="inline">
        <Icon name="package" size={22} />
        <strong>Paczka naklejek za {days(data.streak.nextPack.threshold)}</strong>
      </div>
      <div class="bar"><span style:width="{progress * 100}%"></span></div>
      <p class="muted small">
        Jeszcze {days(data.streak.nextPack.daysLeft)} bez wpadki, a dostaniesz 3 naklejki, w tym
        {data.streak.nextPack.rarity === 'legendary' ? 'jedną legendarną' : 'jedną rzadką'}!
      </p>
      <p class="muted small">Seria rośnie, gdy zrobisz wszystkie zadania danego dnia w terminie.</p>
    </section>

    <section class="section">
      <h2 class="section-title">Historia</h2>
      <div class="list">
        {#each data.ledger as e (e.id)}
          <div class="row">
            <span class="grow">
              <span class="title">{e.label}</span>
              <span class="meta">{dateTime(e.createdAt, session.family!.timezone)}</span>
            </span>
            <span class="amount" class:neg={e.amount < 0}>{e.amount > 0 ? '+' : ''}{e.amount}</span>
          </div>
        {:else}
          <p class="empty">Tu pojawią się zdobyte punkty.</p>
        {/each}
      </div>
    </section>
  {:else if !error}
    <p class="empty">Wczytywanie…</p>
  {/if}
</main>

<style>
  .balance {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 20px;
    background: var(--hero-bg, var(--accent));
    color: var(--hero-text, var(--accent-text));
  }
  .balance .value {
    font-family: var(--font-display);
    font-size: 3.4rem;
    font-weight: 900;
    line-height: 1;
  }
  .balance .label {
    opacity: 0.85;
    font-weight: 600;
  }
  .balance .btn {
    margin-top: 12px;
    background: var(--surface);
    color: var(--text);
  }
  .streaks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .stat .num {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
  }
  .flame {
    color: var(--muted);
  }
  .flame.lit {
    color: #f26b1d;
  }
  .trophy {
    color: #d4a017;
  }
  .next {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    height: 10px;
    border-radius: 5px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #f7a531, #f26b1d);
  }
  .row .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .amount {
    font-weight: 800;
    color: var(--success);
  }
  .amount.neg {
    color: var(--danger);
  }
</style>
