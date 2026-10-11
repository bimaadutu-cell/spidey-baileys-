import { getCurrentUser, isAdmin } from "@/server/auth";
import { AdminDashboard } from "@/components/admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  const allowed = await isAdmin(user);

  if (!allowed) {
    return (
      <div className="card-3d mx-auto max-w-lg rounded-3xl p-8 text-center">
        <p className="text-2xl">🔐</p>
        <h1 className="mt-3 text-xl font-bold neon-text">Halaman admin</h1>
        <p className="mt-2 text-sm text-slate-400">
          Akses ditolak. Autentikasi diperiksa server-side; akun admin dibootstrap dari variabel environment
          ADMIN_USERNAME (akun pertama dengan username tersebut otomatis mendapat role admin).
        </p>
        <a href="/login" className="btn btn-primary mt-5">
          Login admin
        </a>
      </div>
    );
  }

  return <AdminDashboard />;
}
