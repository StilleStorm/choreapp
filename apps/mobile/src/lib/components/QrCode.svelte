<script lang="ts">
  import QRCode from 'qrcode';

  let { value, size = 240 }: { value: string; size?: number } = $props();
  let svg = $state('');

  $effect(() => {
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => (svg = s));
  });
</script>

<div class="qr" style:width="{size}px" style:height="{size}px" role="img" aria-label="Kod QR">
  {@html svg}
</div>

<style>
  .qr {
    background: #fff;
    border-radius: 12px;
    padding: 8px;
    margin: 0 auto;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
