export default function OfflinePage() {
  return (
    <div className="card-3d mx-auto max-w-md rounded-3xl p-8 text-center">
      <p className="text-3xl">📡</p>
      <h1 className="mt-3 text-xl font-bold neon-text">Mode offline</h1>
      <p className="mt-2 text-sm text-slate-400">
        Koneksi internet tidak tersedia. Preset, chat, dan hasil scan diambil langsung dari server, sehingga halaman ini
        hanya menyajikan cache statis.
      </p>
      <a href="/" className="btn btn-primary mt-5">
        Coba lagi
      </a>
    </div>
  );
}
