/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * Used to resume the WhatsApp worker automatically so the bot needs no manual
 * configuration after a restart or redeploy.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await import("./server/runtime-config");

  try {
    const { autoStartWorker } = await import("./server/services/whatsapp-runtime");
    // Delay slightly so the HTTP server is listening before the socket opens.
    setTimeout(() => void autoStartWorker(), 4000);
  } catch (error) {
    console.error("[instrumentation] worker auto-start failed:", error);
  }

  try {
    const { startAutoScan } = await import("./server/services/auto-scan");
    startAutoScan();
  } catch (error) {
    console.error("[instrumentation] auto-scan start failed:", error);
  }
}
